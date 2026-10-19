"""Light, procedural paper materials baked into a sticker's contour layer."""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

STICKER_STYLE = 'nosh-textured-v2'
TEXTURES = ('cotton', 'linen', 'watercolor', 'laid')


def paper_material(size: tuple[int, int], style: str, seed: int, stroke: float) -> Image.Image:
    """Return opaque ivory-white paper; the caller supplies the contour alpha.

    Work at a bounded resolution, with grain sized relative to the outline.
    Randomness is private to one generation, never global or frame-dependent.
    """
    if style not in TEXTURES:
        raise ValueError('Unknown sticker texture')
    scale = min(1.0, 1400 / max(size))
    width, height = [max(1, round(n * scale)) for n in size]
    unit = max(.65, stroke * scale / 18)
    rng = np.random.default_rng(seed)

    def noise(cell_x, cell_y=None):
        cell_y = cell_x if cell_y is None else cell_y
        grid = rng.standard_normal((max(2, int(height / cell_y) + 2),
                                    max(2, int(width / cell_x) + 2))).astype(np.float32)
        return cv2.resize(grid, (width, height), interpolation=cv2.INTER_CUBIC)

    y, x = np.mgrid[:height, :width].astype(np.float32)
    x += rng.uniform(0, 100); y += rng.uniform(0, 100)
    grain = rng.standard_normal((height, width)).astype(np.float32)
    if style == 'cotton':
        surface = .65 * noise(2 * unit) + .3 * noise(10 * unit, unit)
        shade = 2.1 * grain + 2.2 * noise(13 * unit)
    elif style == 'linen':
        warp = np.sin(x * np.pi / (2.5 * unit) + .13 * noise(14 * unit))
        weft = np.sin(y * np.pi / (2.8 * unit) + .13 * noise(14 * unit))
        surface = .75 * warp + .75 * weft + .3 * warp * weft
        shade = 1.1 * grain + 1.1 * noise(15 * unit)
    elif style == 'watercolor':
        surface = 1.2 * noise(3.4 * unit) + .4 * noise(9 * unit)
        shade = 1.5 * grain + 2.3 * noise(20 * unit)
    else:  # laid paper: uneven parallel ridges with sparse cross fibres.
        surface = np.sin((y + .3 * noise(12 * unit)) * np.pi / (2 * unit))
        surface += .25 * np.sin(x * np.pi / (15 * unit)) + .2 * noise(5 * unit, unit)
        shade = 1.3 * grain + 1.5 * noise(18 * unit)
    # Upper-left light and lower-right recesses give fine fibres a shallow relief.
    dx = cv2.Sobel(surface, cv2.CV_32F, 1, 0, ksize=3) / 8
    dy = cv2.Sobel(surface, cv2.CV_32F, 0, 1, ksize=3) / 8
    luminance = np.clip(248 + 6.5 * (dx + dy) + shade, 228, 255)
    rgb = np.stack((luminance, luminance - .8, luminance - 2.2), axis=2)
    material = Image.fromarray(np.rint(rgb).clip(0, 255).astype(np.uint8)).convert('RGBA')
    if material.size != size:
        material = material.resize(size, Image.Resampling.BILINEAR)
    return material
