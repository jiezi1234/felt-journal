"""Exercise a live HTTP service with public/user-selected photos; report, don't grade quality."""
import io
import json
import sys
import time
from pathlib import Path
import httpx
from PIL import Image


def main():
    reports = []
    output = Path('artifacts')
    with httpx.Client(timeout=90, trust_env=False) as client:
        for arg in sys.argv[1:]:
            photo = Path(arg)
            started = time.perf_counter()
            response = client.post('http://127.0.0.1:8787/extract', files={'photo': (photo.name, photo.read_bytes(), 'image/jpeg')})
            response.raise_for_status()
            result = client.get(response.json()['cutoutUrl'])
            result.raise_for_status()
            image = Image.open(io.BytesIO(result.content))
            assert image.mode == 'RGBA' and image.getchannel('A').getextrema() == (0, 255)
            target = output / (photo.stem + '-cutout.png')
            target.write_bytes(result.content)
            reports.append({'photo': str(photo), 'seconds': round(time.perf_counter() - started, 2), 'output': str(target), 'size': image.size, 'alphaMinMax': image.getchannel('A').getextrema(), 'transport': 'live HTTP', 'visualQuality': 'requires inspection'})
    (output / 'live-extraction-samples.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(reports, ensure_ascii=False))


if __name__ == '__main__':
    main()
