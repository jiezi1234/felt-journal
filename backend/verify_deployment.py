"""Verify an already-running service with a real photo, without test substitutes."""
from __future__ import annotations

import argparse
import io
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from PIL import Image


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a private bearer credential to a redirect destination.
        return None


def fetch(url, *, data=None, headers=None, timeout=90):
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
        return response.read(), response.headers.get_content_type()


def expect_unauthorized(url, *, data=None):
    try:
        fetch(url, data=data)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            return
        raise
    raise ValueError('Private endpoint allowed unauthenticated access')


def verify(args):
    service_url = args.url.rstrip('/')
    public_url = urllib.parse.urlsplit(args.expected_public_base.rstrip('/'))
    if public_url.scheme != 'https' or not public_url.netloc or public_url.path:
        raise ValueError('--expected-public-base must be an HTTPS origin without a path')
    if args.internal_download and urllib.parse.urlsplit(service_url).hostname not in {'127.0.0.1', 'localhost', '::1'}:
        raise ValueError('--internal-download is only allowed for a loopback service URL')
    token = os.environ.get('FELT_DEVELOPMENT_TOKEN', '')
    auth = {}
    if token:
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
            raise ValueError('Invalid development credential in environment')
        service = urllib.parse.urlsplit(service_url)
        if service.scheme != 'https' and service.hostname not in {'127.0.0.1', 'localhost', '::1'}:
            raise ValueError('Authenticated verification requires HTTPS or loopback')
        auth['Authorization'] = 'Bearer ' + token

    before = json.loads(fetch(service_url + '/health')[0])
    if before.get('status') != 'ok':
        raise ValueError('Service health check failed')
    if token:
        if not before.get('developmentAccess'):
            raise ValueError('The development access guard is not enabled')
        expect_unauthorized(service_url + '/extract', data=b'')

    photo = Path(args.photo)
    data = photo.read_bytes()
    if not data or len(data) > 15 * 1024 * 1024:
        raise ValueError('Use a non-empty photo no larger than 15 MB')
    boundary = 'felt-smoke-' + uuid.uuid4().hex
    mime = mimetypes.guess_type(photo.name)[0] or 'application/octet-stream'
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="sample"\r\n'
        f'Content-Type: {mime}\r\n\r\n'
    ).encode() + data + f'\r\n--{boundary}--\r\n'.encode()

    started = time.perf_counter()
    response, _ = fetch(service_url + '/extract', data=body, headers={
        **auth,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
    })
    result = json.loads(response)
    cutout = urllib.parse.urlsplit(result.get('cutoutUrl', ''))
    if (cutout.scheme, cutout.netloc) != (public_url.scheme, public_url.netloc):
        raise ValueError('The returned download URL does not use the expected HTTPS origin')
    if not re.fullmatch(r'/cutouts/[0-9a-f]{32}\.png', cutout.path) or cutout.query or cutout.fragment:
        raise ValueError('The returned download URL has an unexpected path')
    if result.get('expiresIn') != 900:
        raise ValueError('The temporary output expiry is unexpected')

    # Internal acceptance can run before DNS/ICP is ready. It deliberately does
    # not claim that the returned public HTTPS URL has been reached.
    download_url = service_url + cutout.path if args.internal_download else result['cutoutUrl']
    if token:
        expect_unauthorized(download_url)
    png, content_type = fetch(download_url, headers=auth)
    if content_type != 'image/png':
        raise ValueError('The download is not served as image/png')
    with Image.open(io.BytesIO(png)) as image:
        image.load()
        if image.format != 'PNG' or image.mode != 'RGBA':
            raise ValueError('The output is not an RGBA PNG')
        alpha_min, alpha_max = image.getchannel('A').getextrema()
        if alpha_min != 0 or alpha_max < 32:
            raise ValueError('The output lacks a transparent background or usable subject')
        size = image.size

    after = json.loads(fetch(service_url + '/health')[0])
    if after.get('status') != 'ok' or after.get('modelLoaded') is not True:
        raise ValueError('The model is not loaded after extraction')
    return {
        'status': 'passed',
        'scope': 'internal HTTP only; public HTTPS and phone acceptance pending' if args.internal_download else 'configured endpoint and HTTPS result download',
        'model': after.get('model'),
        'modelLoadedBefore': before.get('modelLoaded'),
        'modelLoadedAfter': after.get('modelLoaded'),
        'authenticated': bool(token),
        'unauthorizedUploadAndDownloadDenied': bool(token),
        'seconds': round(time.perf_counter() - started, 2),
        'width': size[0], 'height': size[1],
        'mode': 'RGBA', 'alphaMinMax': [alpha_min, alpha_max],
        'downloadBytes': len(png),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8787')
    parser.add_argument('--expected-public-base', required=True)
    parser.add_argument('--photo', required=True)
    parser.add_argument('--internal-download', action='store_true')
    args = parser.parse_args()
    try:
        report = verify(args)
    except urllib.error.HTTPError as error:
        print(json.dumps({'status': 'failed', 'httpStatus': error.code}))
        return 1
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
