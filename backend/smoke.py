"""Real ML + multipart API + download smoke test, no test extractor.
Usage: backend/.venv/Scripts/python.exe -m backend.smoke artifacts/rembg-animal-1.jpg
"""
import io
import json
import sys
import time
from pathlib import Path
from fastapi.testclient import TestClient
from PIL import Image
from backend.app import create_app


def main():
    photo = Path(sys.argv[1])
    started = time.perf_counter()
    with TestClient(create_app(public_base='https://felt.example')) as client:
        response = client.post('/extract', files={'photo': (photo.name, photo.read_bytes(), 'image/jpeg')})
        if response.status_code != 200:
            raise RuntimeError(response.text)
        url = response.json()['cutoutUrl']
        download = client.get(url.removeprefix('https://felt.example'))
        assert download.status_code == 200
        result = Image.open(io.BytesIO(download.content))
        assert result.mode == 'RGBA'
        alpha = result.getchannel('A')
        assert alpha.getextrema() == (0, 255), 'Result must include transparent background and opaque subject'
        target = Path('artifacts/real-subject.png')
        target.write_bytes(download.content)
        report = {'status': 'passed', 'engine': client.get('/health').json()['model'] + ' CPU', 'sample': str(photo), 'seconds': round(time.perf_counter() - started, 2), 'width': result.width, 'height': result.height, 'alphaMinMax': alpha.getextrema(), 'result': str(target), 'scope': 'local real inference and API test; HTTPS deployment and phone quality checks pending'}
        Path('artifacts/extraction-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
