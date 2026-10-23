"""POST /extract multipart photo -> temporary transparent PNG URL.

Run from the repository: python -m uvicorn backend.app:app --host 127.0.0.1 --port 8787
For a phone deployment set FELT_PUBLIC_BASE_URL=https://your-domain.example.
"""
from __future__ import annotations

import io
import asyncio
import ipaddress
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
import warnings
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool
from backend.classification import PhotoClassifier
from backend.sticker_texture import STICKER_STYLE, TEXTURES
from backend.access import AccessStore, WeChatLogin, digest, positive_setting

RUNTIME = Path(__file__).resolve().parent / '.runtime'
os.environ.setdefault('U2NET_HOME', str(RUNTIME / 'models'))
os.environ.setdefault('OMP_NUM_THREADS', '2')
DEFAULT_MODEL = 'nosh-mnn'
MAX_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 24_000_000
TTL_SECONDS = 900
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class SubjectExtractor:
    alignment_version = 1
    sticker_style = STICKER_STYLE
    sticker_textures = TEXTURES

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
            source_size = result.size
            result = result.crop(bbox)
            result.info['source_frame'] = {'sourceWidth': source_size[0], 'sourceHeight': source_size[1],
                                           'x': bbox[0], 'y': bbox[1], 'width': result.width, 'height': result.height}
        from backend.border import textured_sticker
        return textured_sticker(result)


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


def create_app(extractor=None, output_dir=None, public_base=None, classifier=None, development_token=None,
               login_exchange=None, access_store=None, require_auth=None, trust_proxy=None):
    service = FastAPI(title='毛毡手账主体提取', version='1.0.0')
    engine = extractor or SubjectExtractor()
    category_engine = classifier if classifier is not None else PhotoClassifier()
    output = Path(output_dir) if output_dir else RUNTIME / 'cutouts'
    output.mkdir(parents=True, exist_ok=True)
    base = (public_base or os.getenv('FELT_PUBLIC_BASE_URL', 'http://127.0.0.1:8787')).rstrip('/')
    token = development_token if development_token is not None else os.getenv('FELT_DEVELOPMENT_TOKEN', '')
    if token and not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
        raise ValueError('Development access requires a random token of 32–128 URL-safe characters')
    parsed = urlsplit(base)
    try:
        ipv4 = ipaddress.IPv4Address(parsed.hostname or '')
    except ValueError:
        ipv4 = None
    valid_origin = parsed.hostname and not (parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment)
    valid_port = parsed.port is None or 0 < parsed.port <= 65535
    allowed_http = parsed.scheme == 'http' and ipv4 and (str(ipv4) == '127.0.0.1' or token)
    if not (valid_origin and valid_port and (parsed.scheme == 'https' or allowed_http)):
        raise ValueError('Use an HTTPS origin; HTTP IPv4 development requires FELT_DEVELOPMENT_TOKEN')
    lock = threading.Lock()
    app_id, app_secret = os.getenv('FELT_WECHAT_APP_ID', ''), os.getenv('FELT_WECHAT_APP_SECRET', '')
    if login_exchange is None and (app_id or app_secret):
        login_exchange = WeChatLogin(app_id, app_secret)
    required = os.getenv('FELT_REQUIRE_AUTH') == '1' if require_auth is None else require_auth
    if required and login_exchange is None:
        raise ValueError('Production requires configured server-side WeChat login')
    if login_exchange is not None and parsed.scheme != 'https':
        raise ValueError('WeChat session endpoints require HTTPS')
    protected = bool(token or login_exchange)
    access = access_store or (AccessStore(output / 'access.sqlite3') if protected else None)
    trusted_proxy = os.getenv('FELT_TRUST_PROXY') == '1' if trust_proxy is None else trust_proxy
    minute_limit = positive_setting('FELT_EXTRACT_PER_MINUTE', 6)
    day_limit = positive_setting('FELT_EXTRACT_PER_DAY', 60)

    def client_key(request):
        # Caddy overwrites this header. Trust it only with the private loopback-only backend deployment.
        raw = request.headers.get('x-felt-client-ip', '') if trusted_proxy else ''
        if not raw:
            raw = request.client.host if request.client else 'unknown'
        try:
            raw = str(ipaddress.ip_address(raw))
        except ValueError:
            raw = 'unknown'
        return digest(raw)

    async def limited_body(request, maximum, seconds=20):
        async def read():
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > maximum:
                    raise HTTPException(413, '请求内容过大')
                body.extend(chunk)
            return bytes(body)
        try:
            return await asyncio.wait_for(read(), timeout=seconds)
        except TimeoutError:
            raise HTTPException(408, '上传超时，请重试') from None

    @service.middleware('http')
    async def authenticated_access(request: Request, call_next):
        request.state.subject = 'local'
        if protected and request.url.path not in ('/health', '/auth/session'):
            supplied = request.headers.get('authorization', '')
            subject = None
            if token and secrets.compare_digest(supplied.encode(), f'Bearer {token}'.encode()):
                subject = 'development'
            elif login_exchange and supplied.startswith('Bearer ') and len(supplied) <= 135:
                subject = await run_in_threadpool(access.identify, supplied[7:])
            if not subject:
                return JSONResponse({'detail': '登录已过期，请重试'}, status_code=401, headers={'Cache-Control': 'no-store'})
            request.state.subject = subject
        return await call_next(request)

    @service.post('/auth/session')
    async def session(request: Request):
        if login_exchange is None:
            raise HTTPException(503, '登录服务暂未配置')
        def admission():
            key = client_key(request)
            access.consume('login-global', 'all', 60, 60)
            access.consume('login-minute', key, 10, 60)
            access.consume('login-day', key, 100, 86400)
        await run_in_threadpool(admission)
        body = await limited_body(request, 4096, 10)
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(400, '登录请求无效') from None
        code = payload.get('code') if isinstance(payload, dict) else None
        if not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,256}', code):
            raise HTTPException(400, '登录请求无效')
        def exchange():
            return access.issue(login_exchange(code))
        result = await run_in_threadpool(exchange)
        return JSONResponse(result, headers={'Cache-Control': 'no-store'})

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
        if access:
            access.prune()
        return {**({'developmentAccess': True} if token else {}), 'loginEnabled': login_exchange is not None,
                'status': 'ok', 'model': getattr(engine, 'model_name', os.getenv('FELT_MODEL', DEFAULT_MODEL)), 'modelLoaded': getattr(engine, 'session', None) is not None,
                'stickerStyle': getattr(engine, 'sticker_style', None),
                'stickerTextures': list(getattr(engine, 'sticker_textures', ())),
                'alignmentVersion': getattr(engine, 'alignment_version', None),
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
        if length < 0 or len(content_type) > 1024:
            raise HTTPException(400, '照片请求无效')
        if access:
            def admission():
                access.consume('extract-minute', request.state.subject, minute_limit, 60)
                access.consume('extract-day', request.state.subject, day_limit, 86400)
                access.consume('extract-global', 'all', 30, 60)
            await run_in_threadpool(admission)
        # Admit only one upload/decode/inference at a time, before buffering photo bytes.
        if not lock.acquire(blocking=False):
            raise HTTPException(503, '正在处理另一张照片，请稍后重试')
        def process(body):
            image = None
            try:
                parsed = BytesParser(policy=policy.default).parsebytes(('Content-Type: ' + content_type + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
                if not parsed.is_multipart():
                    raise HTTPException(400, '照片请求无效')
                photos = [part.get_payload(decode=True) for part in parsed.iter_parts() if part.get_param('name', header='content-disposition') == 'photo']
                if len(photos) != 1 or not photos[0]:
                    raise HTTPException(400, '每次需要一张照片')
                if len(photos[0]) > MAX_BYTES:
                    raise HTTPException(413, '照片不能超过 15 MB')
                image = decode_photo(photos[0])
                result = engine(image).convert('RGBA')
                filename = uuid.uuid4().hex + '.png'
                prune()
                result.save(output / filename, format='PNG')
                if access:
                    access.own(filename, request.state.subject, TTL_SECONDS)
                try:
                    classification = category_engine(image) if category_engine else {'category': None, 'status': 'disabled'}
                except Exception as error:
                    # Classification is optional: a missing/broken model must not
                    # discard a successfully extracted photo or force a retry.
                    logging.getLogger(__name__).warning('Photo classification unavailable (%s)', type(error).__name__)
                    classification = {'category': None, 'status': 'unavailable'}
                return {'cutoutUrl': f'{base}/cutouts/{filename}', 'expiresIn': TTL_SECONDS, 'classification': classification,
                        **({'alignment': result.info['source_frame']} if result.info.get('source_frame') else {}),
                        **({'stickerTexture': result.info['sticker_texture']} if result.info.get('sticker_texture') else {})}
            finally:
                if image is not None:
                    image.close()

        try:
            body = await limited_body(request, MAX_BYTES + 65536)
            return await run_in_threadpool(process, body)
        except HTTPException:
            raise
        except Exception as error:
            # No raw photo bytes, filesystem paths or credentials in responses.
            raise HTTPException(503, '主体提取暂时失败，请重试或使用原图') from error
        finally:
            lock.release()

    @service.get('/cutouts/{filename}')
    def cutout(filename: str, request: Request):
        if not re.fullmatch(r'[0-9a-f]{32}\.png', filename):
            raise HTTPException(404, '作品不存在')
        if access:
            access.consume('download-minute', request.state.subject, 60, 60)
            if not access.permits(filename, request.state.subject):
                raise HTTPException(404, '作品不存在或已过期')
        file = output / filename
        if not file.is_file() or file.stat().st_mtime < time.time() - TTL_SECONDS:
            prune()
            raise HTTPException(404, '临时主体已过期，请重新提取')
        return FileResponse(file, media_type='image/png', headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})

    return service


app = create_app()
