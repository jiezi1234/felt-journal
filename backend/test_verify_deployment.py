import io
import json
import threading
import unittest
import urllib.error
from argparse import Namespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from PIL import Image
from backend.verify_deployment import fetch, verify


class DeploymentVerificationTests(unittest.TestCase):
    def test_redirect_does_not_forward_bearer(self):
        paths = []

        class Redirect(BaseHTTPRequestHandler):
            def do_GET(self):
                paths.append(self.path)
                self.send_response(302)
                self.send_header('Location', '/other')
                self.end_headers()

            def log_message(self, *_):
                pass

        with ThreadingHTTPServer(('127.0.0.1', 0), Redirect) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    fetch(f'http://127.0.0.1:{server.server_port}/start', headers={'Authorization': 'Bearer test'})
                self.assertEqual(error.exception.code, 302)
                self.assertEqual(paths, ['/start'])
            finally:
                server.shutdown()
                worker.join()

    @patch.dict('os.environ', {'FELT_DEVELOPMENT_TOKEN': 'd' * 43})
    def test_authenticated_probe_refuses_public_plaintext(self):
        with patch('backend.verify_deployment.fetch') as network, self.assertRaises(ValueError):
            verify(Namespace(url='http://192.0.2.10', expected_public_base='https://api.felt.example', internal_download=False))
        network.assert_not_called()

    @patch.dict('os.environ', {'FELT_DEVELOPMENT_TOKEN': 'd' * 43})
    def test_authentication_covers_upload_download_and_negative_probes(self):
        origin = 'https://api.felt.example'
        output = origin + '/cutouts/' + 'a' * 32 + '.png'
        image = Image.new('RGBA', (2, 2), (0, 0, 0, 0))
        image.putpixel((1, 1), (255, 255, 255, 255))
        data = io.BytesIO(); image.save(data, 'PNG')
        protected = []

        def network(url, *, data=None, headers=None):
            if url.endswith('/health'):
                return json.dumps({'status': 'ok', 'modelLoaded': True, 'developmentAccess': True}).encode(), 'application/json'
            authorized = (headers or {}).get('Authorization') == 'Bearer ' + 'd' * 43
            protected.append((url, authorized))
            if not authorized:
                raise urllib.error.HTTPError(url, 401, 'Unauthorized', {}, None)
            if url.endswith('/extract'):
                return json.dumps({'cutoutUrl': output, 'expiresIn': 900}).encode(), 'application/json'
            return png, 'image/png'

        png = data.getvalue()
        with patch('backend.verify_deployment.fetch', side_effect=network), patch('pathlib.Path.read_bytes', return_value=b'fixture'):
            report = verify(Namespace(url=origin, expected_public_base=origin, photo='sample.jpg', internal_download=False))
        self.assertTrue(report['authenticated'])
        self.assertTrue(report['unauthorizedUploadAndDownloadDenied'])
        self.assertEqual(protected, [(origin + '/extract', False), (origin + '/extract', True), (output, False), (output, True)])
