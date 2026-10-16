"""White sticker contour recovered from nosh's FoodStrokeProcessorImpl.

REA evidence ev_362ad8dca4f93dde01e04434bafdfb63f4c1675008fdcfe8df9cd51a24e1dadc
contains the bitmap path in x1.d.invokeSuspend. The plain white variant is
generated before the APK adds its separate colored dot decoration.
"""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

from backend.nosh import clipped_box_blur


def sticker_parameters(size: tuple[int, int], subject_extent: float | None = None) -> dict:
    """Return the APK's dilation, smoothing and temporary-padding parameters.

    The SDK bbox can be passed as subject_extent. Otherwise the already
    cropped cutout's long edge is the closest available equivalent.
    """
    width, height = size
    if width < 1 or height < 1:
        raise ValueError('Expected a nonempty subject image')
    extent = max(size) if subject_extent is None else float(subject_extent)
    if not np.isfinite(extent) or extent <= 0:
        raise ValueError('Expected a positive subject extent')
    base = min(20.0, max(1.5, extent * 0.0066))
    stroke = max(base * 6.0, max(size) * 0.04)
    scale = min(1.0, 1500.0 / max(size))
    radius = max(1, int(stroke * scale))
    blur = max(2, min(6, int(stroke * scale * 0.2)))
    padding = max(2, 2 * blur + radius + 2)
    return {
        'stroke': stroke, 'scale': scale, 'radius': radius, 'blur': blur,
        'padding': padding, 'output_padding': int(padding / scale),
        'working_size': (max(1, int(width * scale)), max(1, int(height * scale))),
    }


def white_sticker(image: Image.Image, *, subject_extent: float | None = None) -> Image.Image:
    """Bake a smooth white contour into an RGBA PNG, preserving transparency.

    Binary support uses alpha > 0, square dilation, two clipped integer box
    blurs, then clamp((gray - 128) * 12 + 128). Original subject pixels are
    composited last at their original resolution. API and exported images
    consequently share the same outline without a client-only effect.
    """
    source = image.convert('RGBA')
    if not source.getchannel('A').getbbox():
        raise ValueError('No subject found')
    params = sticker_parameters(source.size, subject_extent)
    working = source.getchannel('A')
    if params['scale'] < 1:
        working = working.resize(params['working_size'], Image.Resampling.BILINEAR)
    support = np.pad((np.asarray(working) > 0).astype(np.uint8), params['padding'])
    diameter = 2 * params['radius'] + 1
    expanded = cv2.dilate(support, np.ones((diameter, diameter), np.uint8),
                          borderType=cv2.BORDER_CONSTANT, borderValue=0) * 255
    blurred = clipped_box_blur(clipped_box_blur(expanded, params['blur']), params['blur'])
    alpha = np.clip((blurred.astype(np.int16) - 128) * 12 + 128, 0, 255).astype(np.uint8)
    border_alpha = Image.fromarray(alpha)
    padding = params['output_padding']
    output_size = (source.width + 2 * padding, source.height + 2 * padding)
    if border_alpha.size != output_size:
        border_alpha = border_alpha.resize(output_size, Image.Resampling.BILINEAR)
    result = Image.new('RGBA', output_size, (255, 255, 255, 0))
    result.putalpha(border_alpha)
    result.alpha_composite(source, (padding, padding))
    # Match v.x: alpha > 10 bounding box plus one transparent pixel margin.
    bbox = result.getchannel('A').point(lambda value: 255 if value > 10 else 0).getbbox()
    left, top, right, bottom = bbox
    result = result.crop((max(0, left - 1), max(0, top - 1),
                          min(result.width, right + 1), min(result.height, bottom + 1)))
    # Keep fully transparent PNG pixels clean when composited by other renderers.
    pixels = np.array(result)
    pixels[pixels[:, :, 3] == 0, :3] = 0
    return Image.fromarray(pixels)
