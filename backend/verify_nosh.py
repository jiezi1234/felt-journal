"""Real MNN + upload/download verification; photos/results stay out of Git."""
import argparse
import io
import json
from pathlib import Path
import time
from urllib.parse import urlsplit

import httpx
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import SubjectExtractor, create_app
from backend.nosh_model import MODEL_SHA256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('photos', nargs='+', type=Path)
    parser.add_argument('--output-dir', type=Path, default=Path('artifacts/nosh'))
    parser.add_argument('--url', help='Optional running service origin, e.g. http://127.0.0.1:8787')
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    reports = []
    origin = args.url.rstrip('/') if args.url else 'https://felt.example'
    transport = httpx.Client(base_url=origin, timeout=90, trust_env=False) if args.url else TestClient(create_app(extractor=SubjectExtractor('nosh-mnn'), public_base=origin))
    with transport as client:
        assert client.get('/health').json()['model'] == 'nosh-mnn', 'Expected the actual nosh engine'
        for photo in args.photos:
            started = time.perf_counter()
            response = client.post('/extract', files={'photo': (photo.name, photo.read_bytes(), 'image/jpeg')})
            response.raise_for_status()
            download = urlsplit(response.json()['cutoutUrl'])
            assert (download.scheme, download.netloc) == (urlsplit(origin).scheme, urlsplit(origin).netloc)
            result = client.get(download.path)
            result.raise_for_status()
            image = Image.open(io.BytesIO(result.content))
            assert image.mode == 'RGBA' and image.getchannel('A').getextrema() == (0, 255)
            assert client.get('/health').json()['modelLoaded'] is True
            target = args.output_dir / (photo.stem + '-nosh.png')
            target.write_bytes(result.content)
            reports.append({'photo': str(photo), 'seconds': round(time.perf_counter() - started, 3), 'size': image.size, 'alpha': image.getchannel('A').getextrema(), 'result': str(target)})
    report = {'engine': 'nosh-mnn', 'modelSha256': MODEL_SHA256, 'transport': 'live HTTP' if args.url else 'TestClient', 'scope': 'real MNN inference + multipart upload/download; no phone or Android pixel-equivalence claim', 'samples': reports}
    (args.output_dir / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
