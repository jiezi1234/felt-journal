"""Optional local ImageNet classifier; uncertain results never block recording.

Model: ONNX Model Zoo MobileNet v2 opset 12 (Apache-2.0).
The four journal groups are product mappings, not model training classes.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

import numpy as np
from PIL import Image

MODEL_NAME = 'mobilenet-v2'
MODEL_SHA256 = 'c0c3f76d93fa3fd6580652a45618618a220fced18babf65774ed169de0432ad5'
MODEL_URL = 'https://huggingface.co/onnxmodelzoo/mobilenetv2-12/resolve/main/mobilenetv2-12.onnx'
DEFAULT_PATH = Path(__file__).resolve().parent / '.runtime' / 'classification' / 'mobilenetv2-12.onnx'
CATEGORIES = ('饮食', '自然', '出行', '日常')
# Indices follow the ONNX Model Zoo's 1,000-class ImageNet synset order.
# Food includes dishes, produce and drinks; hay remains a natural object.
FOOD = set(range(924, 958)) | set(range(959, 970))
NATURE = set(range(398)) | {958} | set(range(970, 981)) | set(range(984, 999))
# Vehicles / transport: no assumption that every landscape is a trip.
TRAVEL = {403, 404, 405, 407, 408, 436, 444, 466, 468, 472, 510, 554, 555,
          565, 569, 576, 609, 612, 625, 627, 628, 654, 656, 661, 665, 670,
          675, 705, 717, 734, 751, 802, 803, 814, 817, 820, 829, 833, 847,
          864, 866, 867, 870, 874, 880, 895, 914}
GROUPS = np.array([0 if i in FOOD else 1 if i in NATURE else 2 if i in TRAVEL else 3 for i in range(1000)])


def model_path():
    return Path(os.getenv('FELT_CLASSIFIER_MODEL', str(DEFAULT_PATH)))


def verify_model(path):
    path = Path(path)
    if not path.is_file():
        raise ValueError('Classification model missing; run python -m backend.prepare_classification_model --download')
    if path.stat().st_size != 13_964_571 or hashlib.sha256(path.read_bytes()).hexdigest() != MODEL_SHA256:
        raise ValueError('Classification model checksum mismatch')
    return path


def preprocess(image):
    image = image.convert('RGB')
    width, height = image.size
    # Keep the full short edge for journal photos; avoid additional center zoom
    # that can crop away small objects. Resize only the bounded square region.
    size = min(width, height)
    left, top = (width - size) / 2, (height - size) / 2
    image = image.resize((224, 224), Image.Resampling.BILINEAR, box=(left, top, left + size, top + size))
    pixels = np.asarray(image, dtype=np.float32) / 255
    pixels = (pixels - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    return np.ascontiguousarray(pixels.transpose(2, 0, 1)[None])


def category_from_logits(logits):
    values = np.asarray(logits, dtype=np.float64).reshape(-1)
    if values.size != 1000 or not np.isfinite(values).all():
        raise ValueError('Invalid classification output')
    probabilities = np.exp(values - values.max())
    probabilities /= probabilities.sum()
    scores = np.bincount(GROUPS, weights=probabilities, minlength=4)
    order = np.argsort(scores)
    winner = int(order[-1])
    # Softmax scores are a conservative gate, not calibrated correctness rates.
    certain = (probabilities.max() >= .2 and scores[winner] >= .65
               and scores[winner] - scores[order[-2]] >= .25
               and GROUPS[int(probabilities.argmax())] == winner)
    return {'category': CATEGORIES[winner] if certain else None,
            'confidence': round(float(scores[winner]), 4),
            'status': 'classified' if certain else 'uncertain', 'model': MODEL_NAME}


class PhotoClassifier:
    def __init__(self):
        mode = os.getenv('FELT_CLASSIFICATION', MODEL_NAME)
        if mode not in (MODEL_NAME, 'off'):
            raise ValueError('FELT_CLASSIFICATION must be mobilenet-v2 or off')
        self.enabled = mode != 'off'
        self.session = None

    def __call__(self, image):
        if not self.enabled:
            return {'category': None, 'status': 'disabled', 'model': MODEL_NAME}
        if self.session is None:
            import onnxruntime as ort
            path = verify_model(model_path())
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            self.session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
        outputs = self.session.run(None, {self.session.get_inputs()[0].name: preprocess(image)})
        return category_from_logits(outputs[0])
