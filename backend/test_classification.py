import os
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.classification import PhotoClassifier, category_from_logits, preprocess, verify_model


class ClassificationTests(unittest.TestCase):
    def test_clear_objects_and_uncertain_results(self):
        for index, category in [(963, '饮食'), (292, '自然'), (985, '自然'), (466, '出行'), (409, '日常')]:
            logits = np.full(1000, -12.0)
            logits[index] = 12
            result = category_from_logits(logits)
            self.assertEqual(result['category'], category)
            self.assertEqual(result['status'], 'classified')
        self.assertEqual(category_from_logits(np.zeros(1000))['status'], 'uncertain')
        logits = np.full(1000, -12.0)
        logits[292] = logits[963] = 12
        self.assertIsNone(category_from_logits(logits)['category'])

    def test_invalid_output_and_tampered_model(self):
        for logits in [np.zeros(999), np.full(1000, np.nan), np.full(1000, np.inf)]:
            with self.assertRaises(ValueError):
                category_from_logits(logits)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bad.onnx'
            path.write_bytes(b'not a model')
            with self.assertRaises(ValueError):
                verify_model(path)

    def test_preprocessing_is_bounded_rgb_and_centered(self):
        for size in [(800, 600), (1, 2048), (2048, 1)]:
            tensor = preprocess(Image.new('RGBA', size, (128, 64, 32, 255)))
            self.assertEqual(tensor.shape, (1, 3, 224, 224))
            self.assertEqual(tensor.dtype, np.float32)
            self.assertTrue(np.isfinite(tensor).all())
        image = Image.new('RGB', (800, 400), 'red')
        image.paste('blue', (200, 0, 600, 400))
        self.assertTrue(np.all(preprocess(image)[0, 2] > 2))

    def test_disabled_mode_does_not_load_a_model(self):
        with patch.dict(os.environ, {'FELT_CLASSIFICATION': 'off'}):
            classifier = PhotoClassifier()
            self.assertEqual(classifier(Image.new('RGB', (1, 1)))['status'], 'disabled')
            self.assertIsNone(classifier.session)

    def test_classification_success_failure_and_old_flow_keep_cutout(self):
        def broken(_):
            raise RuntimeError('private/model/path')
        for classifier, status in [(lambda _: {'category': '饮食', 'status': 'classified', 'confidence': .9}, 'classified'),
                                   (broken, 'unavailable'), (False, 'disabled')]:
            with tempfile.TemporaryDirectory() as directory:
                with TestClient(create_app(extractor=lambda image: image.convert('RGBA'), output_dir=directory,
                                           public_base='https://felt.example', classifier=classifier)) as client:
                    photo = io.BytesIO()
                    Image.new('RGB', (64, 48), '#CBAA81').save(photo, 'JPEG')
                    response = client.post('/extract', files={'photo': ('photo.jpg', photo.getvalue(), 'image/jpeg')})
                    self.assertEqual(response.status_code, 200)
                    payload = response.json()
                    self.assertEqual(payload['classification']['status'], status)
                    self.assertNotIn('private', response.text)
                    self.assertEqual(client.get(payload['cutoutUrl'].removeprefix('https://felt.example')).status_code, 200)


if __name__ == '__main__':
    unittest.main()
