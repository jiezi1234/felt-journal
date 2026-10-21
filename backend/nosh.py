"""Independent MNN inference and recovered nosh alpha processing.

MainSeg_Wrapper binds SegmentFunctionV2: RGB, INTER_AREA resize and
float32 * (4/255) - 2, followed by NHWC-to-NCHW. These input constants and
the Java mask-processing constants were recovered from the supplied APK.
"""
from __future__ import annotations

import io
import os

import numpy as np
import cv2
from PIL import Image, ImageFilter

from backend.nosh_model import model_path, verify_model

INPUT_SIZE = 224


def clipped_box_blur(values: np.ndarray, radius: int) -> np.ndarray:
    """Integer, separable box filter with clipped windows, as in the APK.

    Unlike an edge-replicating blur, boundary pixels divide by the actual
    available sample count. The Java implementation floors after each axis.
    """
    result = np.asarray(values, dtype=np.uint8)
    for axis in (1, 0):
        length = result.shape[axis]
        coordinates = np.arange(length)
        starts = np.maximum(0, coordinates - radius)
        ends = np.minimum(length, coordinates + radius + 1)
        cumulative = np.cumsum(result, axis=axis, dtype=np.int64)
        pad = [(0, 0), (0, 0)]
        pad[axis] = (1, 0)
        cumulative = np.pad(cumulative, pad)
        sums = np.take(cumulative, ends, axis=axis) - np.take(cumulative, starts, axis=axis)
        counts = ends - starts
        if axis == 0:
            counts = counts[:, None]
        result = (sums // counts).astype(np.uint8)
    return result


def native_mask(image: np.ndarray, infer) -> np.ndarray:
    """Recovered SegmentFunctionV2 defaults: largest subject + ROI refinement."""
    height, width = image.shape[:2]

    def predict(pixels):
        mask = infer(pixels)
        if mask.shape != (INPUT_SIZE, INPUT_SIZE) or not np.isfinite(mask).all():
            raise ValueError('Invalid nosh mask shape or non-finite prediction')
        if float(mask.min()) < -0.001 or float(mask.max()) > 1.001:
            raise ValueError('nosh mask must contain probabilities')
        mask = cv2.bilateralFilter(mask.astype(np.float32), 3, 7, 1, borderType=cv2.BORDER_DEFAULT)
        return cv2.resize(mask, (pixels.shape[1], pixels.shape[0]), interpolation=cv2.INTER_LINEAR)

    mask = predict(image)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0.1).astype(np.uint8), connectivity=8)
    if count <= 1:
        return np.zeros((height, width), dtype=np.uint8)
    label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask *= labels == label
    x, y, box_width, box_height = cv2.boundingRect((mask > 0.5).astype(np.uint8))
    if box_width * box_height < width * height * 0.02:
        return np.zeros((height, width), dtype=np.uint8)
    # Native float bits 0x3ecccccc, multiplied by half the bbox extent.
    margin = np.array([box_width, box_height], dtype=np.float32) * np.float32(0.3999999761581421) * np.float32(0.5)
    lo = np.maximum((np.array([x, y], dtype=np.float32) - margin).astype(np.int32), 0)
    hi = np.minimum((np.array([x + box_width, y + box_height], dtype=np.float32) + margin).astype(np.int32), [width, height])
    left, top = (int(value) for value in lo)
    right, bottom = (int(value) for value in hi)
    if right <= left or bottom <= top:
        raise ValueError('Invalid nosh refinement region')
    refined = predict(image[top:bottom, left:right])
    mask = np.zeros((height, width), dtype=np.float32)
    mask[top:bottom, left:right] = refined
    contours, _ = cv2.findContours((mask > 0.1).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return np.zeros((height, width), dtype=np.uint8)
    keep = np.zeros((height, width), dtype=np.uint8)
    cv2.drawContours(keep, [max(contours, key=cv2.contourArea)], -1, 1, cv2.FILLED, cv2.LINE_8)
    mask *= keep
    return cv2.convertScaleAbs(np.clip((mask - 0.3) / 0.4, 0, 1), alpha=255.0)


def alpha_from_mask(mask: np.ndarray, image_size: tuple[int, int]) -> Image.Image:
    if mask.ndim != 2 or mask.size == 0 or mask.dtype != np.uint8:
        raise ValueError('Expected an 8-bit native grayscale mask')
    mask_width, mask_height = mask.shape[1], mask.shape[0]
    gray = Image.fromarray(mask)
    if max(gray.size) > 512:
        gray.thumbnail((512, 512), Image.Resampling.BILINEAR)
    # SubjectSegmentProcessor.c/d: 5x5 grayscale closing.
    gray = gray.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    width, height = image_size
    scale = min(1.0, 1024 / max(width, height))
    working_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    gray = gray.resize(working_size, Image.Resampling.BILINEAR)
    radius = max(4, int((1024 / max(mask_width, mask_height)) * 0.9))
    values = clipped_box_blur(clipped_box_blur(np.asarray(gray), radius), radius)
    gray = Image.fromarray(values).resize(image_size, Image.Resampling.BILINEAR)
    # The recovered color matrix sums to 2*gray - 64 for a gray RGB mask.
    alpha = np.clip(np.asarray(gray, dtype=np.int16) * 2 - 64, 0, 255).astype(np.uint8)
    return Image.fromarray(alpha)


def crop_subject(image: Image.Image) -> Image.Image:
    alpha = image.getchannel('A')
    low, high = alpha.getextrema()
    if high < 32 or low > 250:
        raise ValueError('No usable subject mask')
    # Recovered transparent-PNG branch: alpha > 10, plus one pixel margin.
    bbox = alpha.point(lambda value: 255 if value > 10 else 0).getbbox()
    if bbox is None:
        raise ValueError('No subject found')
    left, top, right, bottom = bbox
    box = (max(0, left - 1), max(0, top - 1), min(image.width, right + 1), min(image.height, bottom + 1))
    result = image.crop(box)
    result.info['source_frame'] = {'sourceWidth': image.width, 'sourceHeight': image.height,
                                   'x': box[0], 'y': box[1], 'width': result.width, 'height': result.height}
    return result


class NoshSegmenter:
    def __init__(self):
        # Import lazily: the HTTP service can explain a missing model without
        # downloading weights or silently changing inference engines.
        import MNN.expr as expr
        import MNN.nn as nn

        path = verify_model(model_path())
        self.expr = expr
        self.runtime = nn.create_runtime_manager(({
            'backend': 0, 'numThread': int(os.getenv('OMP_NUM_THREADS', '2')), 'precision': 'high',
        },))
        self.module = nn.load_module_from_file(str(path), ['image'], ['mask'], runtime_manager=self.runtime)

    def __call__(self, image: Image.Image) -> Image.Image:
        source = image.convert('RGB')
        source.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        # The SDK's input file is JPEG quality 90; only the model sees this
        # round-trip. Retain source colors for the returned transparent PNG.
        encoded = io.BytesIO()
        source.save(encoded, 'JPEG', quality=90)
        encoded.seek(0)
        with Image.open(encoded) as jpeg:
            pixels = np.asarray(jpeg.convert('RGB'))
        alpha = alpha_from_mask(native_mask(pixels, self.infer), source.size)
        result = source.convert('RGBA')
        result.putalpha(alpha)
        # Keep full cutout resolution for board exports rather than copying
        # nosh's one-third-size UI preview optimization.
        return crop_subject(result)

    def infer(self, pixels: np.ndarray) -> np.ndarray:
        resized = cv2.resize(pixels, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_AREA)
        values = resized.astype(np.float32) * (4.0 / 255.0) - 2.0
        values = np.ascontiguousarray(values.transpose(2, 0, 1)[None])
        expr = self.expr
        tensor = expr.convert(expr.const(values, list(values.shape), expr.NCHW, expr.float), expr.NC4HW4)
        prediction = expr.convert(self.module.forward(tensor), expr.NCHW).read().copy()
        if prediction.shape != (1, 1, INPUT_SIZE, INPUT_SIZE):
            raise ValueError('Unexpected nosh output tensor')
        return prediction[0, 0]
