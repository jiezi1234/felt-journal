import io
import os
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from backend.app import create_app, decode_photo, clean_alpha


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.client = TestClient(create_app(extractor=lambda image: image.convert('RGBA'), output_dir=self.directory.name, public_base='https://felt.example', classifier=False))

    def tearDown(self):
        self.client.close()
        self.directory.cleanup()

    @staticmethod
    def photo():
        data = io.BytesIO()
        Image.new('RGB', (64, 48), '#CBAA81').save(data, 'JPEG')
        return data.getvalue()

    def test_upload_download_expiry(self):
        response = self.client.post('/extract', files={'photo': ('photo.jpg', self.photo(), 'image/jpeg')})
        self.assertEqual(response.status_code, 200)
        url = response.json()['cutoutUrl']
        self.assertTrue(url.startswith('https://felt.example/cutouts/'))
        path = url.removeprefix('https://felt.example')
        png = self.client.get(path)
        self.assertEqual(png.status_code, 200)
        self.assertEqual(Image.open(io.BytesIO(png.content)).mode, 'RGBA')
        file = Path(self.directory.name) / path.split('/')[-1]
        expired = time.time() - 901
        os.utime(file, (expired, expired))
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_invalid_and_duplicate_photo(self):
        self.assertEqual(self.client.post('/extract', files={'photo': ('bad.jpg', b'bad', 'image/jpeg')}).status_code, 415)
        self.assertEqual(self.client.post('/extract', files=[('photo', ('a.jpg', self.photo())), ('photo', ('b.jpg', self.photo()))]).status_code, 400)
        self.assertEqual(self.client.post('/extract', content=b'bad').status_code, 415)
        self.assertEqual(self.client.get('/cutouts/not-a-token.png').status_code, 404)

    def test_inference_failure_and_retry_releases_lock(self):
        def broken(image):
            raise RuntimeError('fake internal path or secret')
        client = TestClient(create_app(extractor=broken, output_dir=self.directory.name))
        for _ in range(2):
            r = client.post('/extract', files={'photo': ('photo.jpg', self.photo())})
            self.assertEqual(r.status_code, 503)
            self.assertNotIn('secret', r.text)
        client.close()

    def test_downsize(self):
        data = io.BytesIO()
        Image.new('RGB', (3000, 2000)).save(data, 'JPEG')
        result = decode_photo(data.getvalue())
        self.assertEqual(result.width, 2048)

    def test_camera_mpo_decodes_first_jpeg_frame(self):
        data = io.BytesIO()
        first = Image.new('RGB', (64, 48), '#CBAA81')
        first.save(data, 'MPO', save_all=True, append_images=[Image.new('RGB', (64, 48), '#123456')])
        self.assertEqual(Image.open(io.BytesIO(data.getvalue())).format, 'MPO')
        result = decode_photo(data.getvalue())
        self.assertEqual(result.size, (64, 48))
        self.assertGreater(result.getpixel((0, 0))[0], 150)

    def test_mask_cleanup_removes_isolated_debris_and_keeps_soft_edges(self):
        image = Image.new('RGBA', (64, 48), (255, 255, 255, 0))
        for x in range(20, 40):
            for y in range(15, 30):
                image.putpixel((x, y), (100, 70, 40, 255))
        image.putpixel((19, 20), (100, 70, 40, 64))
        image.putpixel((3, 3), (100, 70, 40, 64))
        image.putpixel((60, 40), (100, 70, 40, 255))
        result = clean_alpha(image)
        self.assertEqual(result.getpixel((30, 20))[3], 255)
        self.assertEqual(result.getpixel((19, 20))[3], 64)
        self.assertEqual(result.getpixel((3, 3))[3], 0)
        self.assertEqual(result.getpixel((60, 40))[3], 0)


if __name__ == '__main__':
    unittest.main()
