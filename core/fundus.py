"""Fundus image preprocessing shared by training and inference.

All functions are pure and deterministic: same input bytes -> same output array.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import cv2
import numpy as np

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


@dataclass
class CropTransform:
    """Maps original-image pixel coords <-> square canonical coords.

    canonical = (orig - (x0, y0) + (pad_x, pad_y)) * scale
    """

    x0: int
    y0: int
    pad_x: int
    pad_y: int
    side: int  # side of the padded square in original pixels
    size: int  # output side in pixels
    orig_w: int
    orig_h: int

    @property
    def scale(self) -> float:
        return self.size / float(self.side)

    def to_canonical(self, x: float, y: float) -> tuple[float, float]:
        return ((x - self.x0 + self.pad_x) * self.scale, (y - self.y0 + self.pad_y) * self.scale)

    def to_original(self, u: float, v: float) -> tuple[float, float]:
        return (u / self.scale - self.pad_x + self.x0, v / self.scale - self.pad_y + self.y0)

    def as_dict(self) -> dict:
        return asdict(self)


def decode_image(data: bytes) -> np.ndarray:
    """Decode bytes to an RGB uint8 array. Raises ValueError if not an image."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("not a decodable image")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def fundus_mask(rgb: np.ndarray, thresh: int = 12) -> np.ndarray:
    """Binary mask of the illuminated fundus disc (largest bright component)."""
    small_scale = 512.0 / max(rgb.shape[:2])
    if small_scale < 1.0:
        small = cv2.resize(rgb, None, fx=small_scale, fy=small_scale, interpolation=cv2.INTER_AREA)
    else:
        small, small_scale = rgb, 1.0
    gray = small.max(axis=2)
    m = (gray > thresh).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1:
        out = np.zeros(rgb.shape[:2], np.uint8)
        return out
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    m = (lab == k).astype(np.uint8)
    if small_scale != 1.0:
        m = cv2.resize(m, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_NEAREST)
    return m


def crop_square(rgb: np.ndarray, size: int, mask: np.ndarray | None = None) -> tuple[np.ndarray, CropTransform]:
    """Crop to the fundus bounding box, pad to a centred square, resize to size x size."""
    h, w = rgb.shape[:2]
    if mask is None:
        mask = fundus_mask(rgb)
    ys, xs = np.nonzero(mask)
    if len(xs) < 100:
        x0, y0, x1, y1 = 0, 0, w, h
    else:
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
    cw, ch = x1 - x0, y1 - y0
    side = max(cw, ch)
    pad_x, pad_y = (side - cw) // 2, (side - ch) // 2
    canvas = np.zeros((side, side, 3), np.uint8)
    canvas[pad_y : pad_y + ch, pad_x : pad_x + cw] = rgb[y0:y1, x0:x1]
    interp = cv2.INTER_AREA if side > size else cv2.INTER_CUBIC
    out = cv2.resize(canvas, (size, size), interpolation=interp)
    return out, CropTransform(x0, y0, pad_x, pad_y, side, size, w, h)


def crop_mask_like(mask: np.ndarray, t: CropTransform) -> np.ndarray:
    """Apply the same crop/pad/resize to a single-channel label mask (nearest)."""
    ch = min(t.side - t.pad_y, mask.shape[0] - t.y0)
    cw = min(t.side - t.pad_x, mask.shape[1] - t.x0)
    canvas = np.zeros((t.side, t.side), mask.dtype)
    canvas[t.pad_y : t.pad_y + ch, t.pad_x : t.pad_x + cw] = mask[t.y0 : t.y0 + ch, t.x0 : t.x0 + cw]
    return cv2.resize(canvas, (t.size, t.size), interpolation=cv2.INTER_NEAREST)


def circle_mask(size: int, margin: float = 0.0) -> np.ndarray:
    yy, xx = np.mgrid[:size, :size]
    c = (size - 1) / 2.0
    r = size / 2.0 * (1.0 - margin)
    return (((xx - c) ** 2 + (yy - c) ** 2) <= r * r).astype(np.uint8)


def to_tensor_input(rgb_square: np.ndarray, size: int) -> np.ndarray:
    """Canonical square RGB uint8 -> float32 NCHW ImageNet-normalised array."""
    if rgb_square.shape[0] != size:
        rgb_square = cv2.resize(rgb_square, (size, size), interpolation=cv2.INTER_AREA)
    x = rgb_square.astype(np.float32) / 255.0
    x = (x - IMAGENET_MEAN) / IMAGENET_STD
    return np.ascontiguousarray(x.transpose(2, 0, 1)[None])
