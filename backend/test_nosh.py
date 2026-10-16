import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
from PIL import Image

from backend.nosh import alpha_from_mask, clipped_box_blur, crop_subject, native_mask
from backend.nosh_model import import_model, verify_model
from backend.app import SubjectExtractor


class NoshTests(unittest.TestCase):
    def test_box_blur_uses_only_existing_boundary_pixels(self):
        # Edge replication would produce 85 rather than 127 at either end.
        values = np.array([[0, 255, 0]], dtype=np.uint8)
        self.assertEqual(clipped_box_blur(values, 1).tolist(), [[127, 85, 127]])

    def test_mask_validation_and_alpha_limits(self):
        self.assertEqual(alpha_from_mask(np.zeros((224, 224), np.uint8), (80, 40)).getextrema(), (0, 0))
        self.assertEqual(alpha_from_mask(np.full((224, 224), 255, np.uint8), (80, 40)).getextrema(), (255, 255))
        for mask in [np.zeros((0, 0), np.uint8), np.full((224, 224), np.nan), np.zeros((10, 10, 3), np.uint8)]:
            with self.assertRaises(ValueError):
                alpha_from_mask(mask, (80, 40))

    def test_native_flow_refines_only_selected_subject(self):
        calls = []
        def infer(pixels):
            calls.append(pixels.shape[:2])
            mask = np.zeros((224, 224), np.float32)
            mask[60:160, 70:170] = 1
            if len(calls) == 1:
                mask[5:15, 5:15] = 1
            return mask
        mask = native_mask(np.zeros((200, 300, 3), np.uint8), infer)
        self.assertEqual(len(calls), 2)
        self.assertLess(calls[1][0], 200)
        self.assertLess(calls[1][1], 300)
        self.assertEqual(mask.shape, (200, 300))
        self.assertEqual(int(mask[8, 8]), 0)
        self.assertEqual(int(mask.max()), 255)

    def test_native_flow_rejects_invalid_predictions(self):
        pixels = np.zeros((80, 100, 3), np.uint8)
        for bad in [np.zeros((10, 10)), np.full((224, 224), np.nan), np.full((224, 224), 2.0)]:
            with self.assertRaises(ValueError):
                native_mask(pixels, lambda _, bad=bad: bad)

    def test_crop_preserves_disconnected_subjects_and_original_color(self):
        image = Image.new('RGBA', (60, 40), (0, 0, 0, 0))
        image.paste((140, 60, 20, 255), (10, 10, 20, 20))
        image.paste((20, 60, 140, 255), (40, 10, 50, 20))
        image.putpixel((2, 2), (255, 255, 255, 8))
        cutout = crop_subject(image)
        self.assertEqual(cutout.size, (42, 12))
        self.assertEqual(cutout.getpixel((1, 1)), (140, 60, 20, 255))
        self.assertEqual(cutout.getpixel((31, 1)), (20, 60, 140, 255))
        self.assertEqual(cutout.getpixel((20, 5))[3], 0)

    def test_empty_and_opaque_masks_are_not_successful_cutouts(self):
        for alpha in (0, 255):
            with self.assertRaises(ValueError):
                crop_subject(Image.new('RGBA', (60, 40), (40, 80, 120, alpha)))

    def test_unverified_apk_cannot_overwrite_model_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            apk = Path(directory) / 'different.apk'
            output = Path(directory) / 'model.mnn'
            output.write_bytes(b'existing-cache')
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr('assets/main_segment.bin', b'different-model')
            with self.assertRaises(ValueError):
                import_model(apk, output, apk=True)
            self.assertEqual(output.read_bytes(), b'existing-cache')

    def test_missing_model_has_no_silent_rembg_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {'FELT_NOSH_MODEL': str(Path(directory) / 'missing.mnn')}):
                extractor = SubjectExtractor('nosh-mnn')
                with self.assertRaises(ValueError):
                    extractor(Image.new('RGB', (64, 48)))
                self.assertIsNone(extractor.session)
                with self.assertRaises(ValueError):
                    verify_model(Path(directory) / 'missing.mnn')


if __name__ == '__main__':
    unittest.main()
