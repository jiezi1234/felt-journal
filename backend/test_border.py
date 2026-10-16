import io
import tempfile
import unittest

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from backend.app import SubjectExtractor, create_app
from backend.border import sticker_parameters, white_sticker


def subject():
    image = Image.new('RGBA', (102, 102), (0, 0, 0, 0))
    ImageDraw.Draw(image).ellipse((1, 1, 100, 100), fill=(120, 55, 30, 255))
    return image


class BorderTests(unittest.TestCase):
    def test_recovered_parameters_scale_and_clamp(self):
        small = sticker_parameters((100, 60))
        self.assertEqual((small['stroke'], small['radius'], small['blur'], small['padding']), (9, 9, 2, 15))
        large = sticker_parameters((1600, 800))
        self.assertEqual(large['stroke'], 64)
        self.assertEqual((large['scale'], large['radius'], large['blur']), (0.9375, 60, 6))
        self.assertEqual(large['working_size'], (1500, 750))
        self.assertEqual(large['output_padding'], 78)
        self.assertAlmostEqual(sticker_parameters((100, 60), 1000)['stroke'], 39.6)

    def test_white_band_follows_alpha_and_corners_remain_transparent(self):
        result = white_sticker(subject())
        pixels = np.asarray(result)
        for x, y in [(0, 0), (result.width - 1, 0), (0, result.height - 1),
                     (result.width - 1, result.height - 1)]:
            self.assertEqual(result.getpixel((x, y)), (0, 0, 0, 0))
        center = pixels[result.height // 2]
        white = np.all(center[:, :3] == 255, axis=1) & (center[:, 3] == 255)
        self.assertGreaterEqual(np.count_nonzero(white), 14)
        self.assertTrue(np.any((pixels[:, :, 3] > 0) & (pixels[:, :, 3] < 255)))
        self.assertEqual(result.getpixel((result.width // 2, result.height // 2)), (120, 55, 30, 255))

    def test_separate_subjects_and_large_hole_stay_transparent(self):
        image = Image.new('RGBA', (182, 82), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((1, 1, 80, 80), fill=(200, 10, 20, 255))
        draw.rectangle((21, 21, 60, 60), fill=(0, 0, 0, 0))
        draw.rectangle((151, 21, 180, 60), fill=(10, 20, 200, 255))
        result = white_sticker(image)
        pixels = np.asarray(result)
        red = np.argwhere(np.all(pixels == (200, 10, 20, 255), axis=2))
        offset_y, offset_x = red.min(axis=0) - [1, 1]
        self.assertEqual(result.getpixel((int(offset_x + 40), int(offset_y + 40)))[3], 0)
        self.assertEqual(result.getpixel((int(offset_x + 115), int(offset_y + 40)))[3], 0)
        self.assertEqual(result.getpixel((int(offset_x + 160), int(offset_y + 40))), (10, 20, 200, 255))

    def test_large_subject_keeps_original_resolution_and_color(self):
        image = Image.new('RGBA', (1602, 30), (0, 0, 0, 0))
        ImageDraw.Draw(image).rectangle((1, 1, 1600, 28), fill=(13, 79, 157, 255))
        result = white_sticker(image)
        pixels = np.asarray(result)
        subject_pixels = np.all(pixels == (13, 79, 157, 255), axis=2)
        self.assertEqual(int(subject_pixels.sum()), 1600 * 28)
        self.assertGreater(result.width, 1602)
        self.assertEqual(result.getpixel((0, 0))[3], 0)

    def test_extractor_png_served_by_api_is_the_same_sticker(self):
        extractor = SubjectExtractor('nosh-mnn')
        extractor.session = lambda image: subject()
        expected = white_sticker(subject())
        data = io.BytesIO()
        Image.new('RGB', (102, 102)).save(data, 'JPEG')
        with tempfile.TemporaryDirectory() as directory:
            with TestClient(create_app(extractor=extractor, output_dir=directory)) as client:
                response = client.post('/extract', files={'photo': ('test.jpg', data.getvalue(), 'image/jpeg')})
                self.assertEqual(response.status_code, 200)
                url = response.json()['cutoutUrl']
                png = client.get('/cutouts/' + url.rsplit('/', 1)[1])
                with Image.open(io.BytesIO(png.content)) as actual:
                    self.assertEqual(actual.mode, 'RGBA')
                    self.assertEqual(actual.size, expected.size)
                    self.assertEqual(actual.tobytes(), expected.tobytes())

    def test_empty_subject_is_rejected(self):
        with self.assertRaises(ValueError):
            white_sticker(Image.new('RGBA', (30, 30)))


if __name__ == '__main__':
    unittest.main()
