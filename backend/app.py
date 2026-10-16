"""POST /extract multipart photo -> temporary transparent PNG URL.

Run from the repository: python -m uvicorn backend.app:app --host 127.0.0.1 --port 8787
For a phone deployment set FELT_PUBLIC_BASE_URL=https://your-domain.example.
"""
from __future__ import annotations

import io
import logging
import os
import re
import threading
import time
import uuid
import warnings
from email import policy
from email.parser import BytesParser
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool
from backend.classification import PhotoClassifier

RUNTIME = Path(__file__).resolve().parent / '.runtime'
os.environ.setdefault('U2NET_HOME', str(RUNTIME / 'models'))
os.environ.setdefault('OMP_NUM_THREADS', '2')
DEFAULT_MODEL = 'nosh-mnn'
MAX_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 24_000_000
TTL_SECONDS = 900
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class SubjectExtractor:
    def __init__(self, model_name=None):
        self.session = None
        self.model_name = model_name or os.getenv('FELT_MODEL', DEFAULT_MODEL)

    def __call__(self, image: Image.Image) -> Image.Image:
        # The ML backend is loaded only when a real photo is processed.
        if self.model_name == 'nosh-mnn':
            from backend.nosh import NoshSegmenter
            if self.session is None:
                self.session = NoshSegmenter()
            result = self.session(image)
        else:
            from rembg import new_session, remove
            if self.session is None:
                self.session = new_session(self.model_name, providers=['CPUExecutionProvider'])
            result = clean_alpha(remove(image, session=self.session).convert('RGBA'))
            alpha = result.getchannel('A')
            low, high = alpha.getextrema()
            if high < 32 or low > 250:
                raise ValueError('No usable subject mask')
            bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
            if not bbox:
                raise ValueError('No subject found')
            result = result.crop(bbox)
        from backend.border import white_sticker
        return white_sticker(result)


def clean_alpha(result: Image.Image) -> Image.Image:
    """Remove weak isolated mask debris, retaining substantial subject groups.

    Retain soft edges of confident components; do not impose a rectangular crop
    or silently turn an uncertain mask into an opaque original photo.
    """
    import numpy as np
    from scipy.ndimage import label
    alpha = np.asarray(result.getchannel('A'))
    components, _ = label(alpha > 16)
    confident = np.bincount(components.ravel(), weights=(alpha >= 128).ravel())
    keep = confident >= max(16, int(alpha.size * 0.00002))
    keep[0] = False
    cleaned = np.where(keep[components], alpha, 0).astype('uint8')
    result.putalpha(Image.fromarray(cleaned))
    return result


def decode_photo(data: bytes) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(data))
            # Some cameras store a normal JPEG frame inside an MPO container.
            # P0 handles one photo, so decode its first frame, preserving the
            # uploaded original independently in the client.
            if image.format not in {'JPEG', 'MPO', 'PNG', 'WEBP'}:
                raise ValueError('Unsupported format')
            image.seek(0)
            if image.width * image.height > MAX_PIXELS:
                raise ValueError('Too many pixels')
            image.load()
            image = ImageOps.exif_transpose(image).convert('RGB')
            image.thumbnail((2048, 2048))
            return image
    except (ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise HTTPException(415, '请选择 24 百万像素以内的 JPEG、PNG 或 WEBP 照片') from error


def create_app(extractor=None, output_dir=None, public_base=None, classifier=None):
    service = FastAPI(title='毛毡手账主体提取', version='1.0.0')
    engine = extractor or SubjectExtractor()
    category_engine = classifier if classifier is not None else PhotoClassifier()
    output = Path(output_dir) if output_dir else RUNTIME / 'cutouts'
    output.mkdir(parents=True, exist_ok=True)
    base = (public_base or os.getenv('FELT_PUBLIC_BASE_URL', 'http://127.0.0.1:8787')).rstrip('/')
    if not (base.startswith('https://') or base.startswith('http://127.0.0.1:')):
        raise ValueError('FELT_PUBLIC_BASE_URL must be HTTPS (loopback allowed for local tests)')
    lock = threading.Lock()

    def prune():
        threshold = time.time() - TTL_SECONDS
        for file in output.glob('*.png'):
            try:
                if file.stat().st_mtime < threshold:
                    file.unlink(missing_ok=True)
            except OSError:
                pass

    @service.get('/health')
    def health():
        prune()
        return {'status': 'ok', 'model': getattr(engine, 'model_name', os.getenv('FELT_MODEL', DEFAULT_MODEL)), 'modelLoaded': getattr(engine, 'session', None) is not None,
                'classificationEnabled': getattr(category_engine, 'enabled', bool(category_engine)),
                'classificationLoaded': getattr(category_engine, 'session', None) is not None}

    @service.post('/extract')
    async def extract(request: Request):
        content_type = request.headers.get('content-type', '')
        if not content_type.startswith('multipart/form-data;'):
            raise HTTPException(415, '需要 multipart/form-data 照片')
        try:
            length = int(request.headers.get('content-length', '0'))
        except ValueError as error:
            raise HTTPException(400, '照片请求无效') from error
        if length > MAX_BYTES + 65536:
            raise HTTPException(413, '照片不能超过 15 MB')
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BYTES + 65536:
                raise HTTPException(413, '照片不能超过 15 MB')
        parsed = BytesParser(policy=policy.default).parsebytes(('Content-Type: ' + content_type + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
        if not parsed.is_multipart():
            raise HTTPException(400, '照片请求无效')
        photos = [part.get_payload(decode=True) for part in parsed.iter_parts() if part.get_param('name', header='content-disposition') == 'photo']
        if len(photos) != 1 or not photos[0]:
            raise HTTPException(400, '每次需要一张照片')
        if len(photos[0]) > MAX_BYTES:
            raise HTTPException(413, '照片不能超过 15 MB')
        image = decode_photo(photos[0])
        if not lock.acquire(blocking=False):
            image.close()
            raise HTTPException(503, '正在处理另一张照片，请稍后重试')

        def process():
            try:
                result = engine(image).convert('RGBA')
                token = uuid.uuid4().hex
                prune()
                result.save(output / f'{token}.png', format='PNG')
                try:
                    classification = category_engine(image) if category_engine else {'category': None, 'status': 'disabled'}
                except Exception as error:
                    # Classification is optional: a missing/broken model must not
                    # discard a successfully extracted photo or force a retry.
                    logging.getLogger(__name__).warning('Photo classification unavailable (%s)', type(error).__name__)
                    classification = {'category': None, 'status': 'unavailable'}
                return {'cutoutUrl': f'{base}/cutouts/{token}.png', 'expiresIn': TTL_SECONDS, 'classification': classification}
            finally:
                image.close()
                lock.release()

        try:
            return await run_in_threadpool(process)
        except Exception as error:
            # No raw photo bytes, filesystem paths or credentials in responses.
            raise HTTPException(503, '主体提取暂时失败，请重试或使用原图') from error

    @service.get('/cutouts/{filename}')
    def cutout(filename: str):
        if not re.fullmatch(r'[0-9a-f]{32}\.png', filename):
            raise HTTPException(404, '作品不存在')
        file = output / filename
        if not file.is_file() or file.stat().st_mtime < time.time() - TTL_SECONDS:
            prune()
            raise HTTPException(404, '临时主体已过期，请重新提取')
        return FileResponse(file, media_type='image/png', headers={'Cache-Control': 'private, max-age=60'})

    return service


app = create_app()
