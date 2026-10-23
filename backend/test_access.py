import io
import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from backend.access import AccessStore, WeChatLogin, digest, SESSION_TTL
from backend.app import create_app


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = [1800000000.0]
        self.store = AccessStore(Path(self.temp.name) / 'access.sqlite3', clock=lambda: self.now[0])

    def tearDown(self):
        self.temp.cleanup()

    def test_sessions_are_hashed_persistent_and_expire(self):
        issued = self.store.issue('alice')
        self.assertNotIn(issued['token'].encode(), Path(self.store.database).read_bytes())
        reopened = AccessStore(Path(self.store.database), clock=lambda: self.now[0])
        self.assertEqual(reopened.identify(issued['token']), 'alice')
        self.assertIsNone(reopened.identify('bad'))
        self.now[0] += SESSION_TTL
        self.assertIsNone(reopened.identify(issued['token']))
        reopened.prune()
        with reopened.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0], 0)

    def test_quota_is_atomic_persistent_and_recovers_after_window(self):
        def attempt(_):
            try:
                self.store.consume('upload', 'alice', 6, 60)
                return True
            except HTTPException as error:
                self.assertEqual(error.status_code, 429)
                self.assertGreater(int(error.headers['Retry-After']), 0)
                return False
        with ThreadPoolExecutor(max_workers=12) as pool:
            self.assertEqual(sum(pool.map(attempt, range(12))), 6)
        reopened = AccessStore(Path(self.store.database), clock=lambda: self.now[0])
        with self.assertRaises(HTTPException):
            reopened.consume('upload', 'alice', 6, 60)
        reopened.consume('upload', 'bob', 6, 60)
        self.now[0] += 60
        reopened.consume('upload', 'alice', 6, 60)

    def test_wechat_exchange_discards_secret_and_session_key(self):
        login = WeChatLogin('wx' + '0' * 16, 's' * 32)
        with patch('urllib.request.build_opener') as factory:
            factory.return_value.open.return_value = io.BytesIO(json.dumps({'openid': 'alice', 'session_key': 'never-return-this'}).encode())
            self.assertEqual(login('code'), digest(login.app_id + ':alice'))
            url = factory.return_value.open.call_args.args[0]
            self.assertTrue(url.startswith('https://api.weixin.qq.com/sns/jscode2session?'))
            self.assertIn('grant_type=authorization_code', url)
        for result, expected in [({'errcode': 40029}, 401), ({'errcode': 40163}, 401), ({'errcode': 45011}, 429), ({'errcode': 40125}, 503), ([], 503)]:
            with patch('urllib.request.build_opener') as factory:
                factory.return_value.open.return_value = io.BytesIO(json.dumps(result).encode())
                with self.assertRaises(HTTPException) as caught:
                    login('code')
                self.assertEqual(caught.exception.status_code, expected)
        with patch('urllib.request.build_opener') as factory:
            factory.return_value.open.side_effect = RuntimeError('secret-in-provider-url')
            with self.assertRaises(HTTPException) as caught:
                login('code')
            self.assertNotIn('secret-in-provider-url', str(caught.exception))

    def app(self, **options):
        return create_app(extractor=lambda image: image.convert('RGBA'), classifier=False,
                          output_dir=self.temp.name, public_base='https://felt.example',
                          access_store=self.store, login_exchange=lambda code: digest(code), **options)

    @staticmethod
    def photo():
        data = io.BytesIO()
        Image.new('RGB', (20, 20), 'red').save(data, 'JPEG')
        return {'photo': ('public-test.jpg', data.getvalue(), 'image/jpeg')}

    def test_login_upload_ownership_refresh_and_expiry(self):
        with TestClient(self.app(require_auth=True)) as client:
            self.assertTrue(client.get('/health').json()['loginEnabled'])
            self.assertEqual(client.post('/extract', files=self.photo()).status_code, 401)
            def login(code):
                r = client.post('/auth/session', json={'code': code, 'openid': 'ignored-client-identity'})
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.headers['cache-control'], 'no-store')
                self.assertEqual(set(r.json()), {'token', 'expiresIn'})
                return {'Authorization': 'Bearer ' + r.json()['token']}
            alice, bob = login('alice'), login('bob')
            r = client.post('/extract', files=self.photo(), headers=alice)
            self.assertEqual(r.status_code, 200)
            url = r.json()['cutoutUrl']
            self.assertEqual(client.get(url).status_code, 401)
            self.assertEqual(client.get(url, headers=bob).status_code, 404)
            self.assertEqual(client.get(url, headers=alice).status_code, 200)
            refreshed = login('alice')
            self.assertEqual(client.get(url, headers=refreshed).status_code, 200)
            self.now[0] += 901
            self.assertEqual(client.get(url, headers=alice).status_code, 404)
            self.now[0] += SESSION_TTL
            self.assertEqual(client.post('/extract', files=self.photo(), headers=alice).status_code, 401)

    def test_quotas_apply_before_photo_decode_and_survive_new_session(self):
        with patch.dict('os.environ', {'FELT_EXTRACT_PER_MINUTE': '1'}), TestClient(self.app()) as client:
            headers = {'Authorization': 'Bearer ' + client.post('/auth/session', json={'code': 'alice'}).json()['token']}
            self.assertEqual(client.post('/extract', files=self.photo(), headers=headers).status_code, 200)
            headers = {'Authorization': 'Bearer ' + client.post('/auth/session', json={'code': 'alice'}).json()['token']}
            with patch('backend.app.decode_photo', side_effect=AssertionError('must not decode throttled bytes')):
                r = client.post('/extract', files=self.photo(), headers=headers)
                self.assertEqual(r.status_code, 429)
                self.assertIn('retry-after', r.headers)

    def test_login_validation_ip_spoofing_and_required_configuration(self):
        with TestClient(self.app()) as client:
            self.assertEqual(client.post('/auth/session', content=b'x' * 4097).status_code, 413)
            self.assertEqual(client.post('/auth/session', json={'code': []}).status_code, 400)
            self.assertEqual(client.post('/auth/session', json={'code': 'bad code'}).status_code, 400)
            self.assertEqual(client.post('/auth/session', content=b'bad').status_code, 400)
            for i in range(6):
                self.assertEqual(client.post('/auth/session', json={'code': 'ok'}, headers={'X-Felt-Client-IP': f'192.0.2.{i}'}).status_code, 200)
            self.assertEqual(client.post('/auth/session', json={'code': 'ok'}, headers={'X-Felt-Client-IP': '192.0.2.99'}).status_code, 429)
        with self.assertRaises(ValueError):
            create_app(output_dir=self.temp.name, require_auth=True)

    def test_development_and_wechat_results_are_isolated(self):
        with TestClient(self.app(development_token='d' * 43)) as client:
            dev = {'Authorization': 'Bearer ' + 'd' * 43}
            user = {'Authorization': 'Bearer ' + client.post('/auth/session', json={'code': 'alice'}).json()['token']}
            url = client.post('/extract', files=self.photo(), headers=dev).json()['cutoutUrl']
            self.assertEqual(client.get(url, headers=dev).status_code, 200)
            self.assertEqual(client.get(url, headers=user).status_code, 404)


if __name__ == '__main__':
    unittest.main()
