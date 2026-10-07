"""Robust image loading: EXIF orientation, alpha, 16-bit, palette, first frame."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".jfif"}


class ImageLoadError(Exception):
    pass


def load_image(source):
    """Load a path / PIL image / numpy array as a 3-channel uint8 BGR array."""
    if isinstance(source, np.ndarray):
        return _array_to_bgr(source)
    if isinstance(source, Image.Image):
        return _pil_to_bgr(source)
    path = Path(source).expanduser()
    if not path.is_file():
        raise ImageLoadError(f"File does not exist: {path}")
    if path.stat().st_size == 0:
        raise ImageLoadError(f"File is empty: {path.name}")
    try:
        with Image.open(path) as image:
            image.seek(0)  # first frame of GIF/TIFF/WebP animations
            return _pil_to_bgr(ImageOps.exif_transpose(image))
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ImageLoadError(f"Cannot decode image (corrupt or unsupported): {path.name}") from exc


def _pil_to_bgr(image):
    if image.mode in ("I;16", "I;16B", "I;16L", "I"):
        array = np.asarray(image, dtype=np.float64)
        span = float(array.max() - array.min()) or 1.0
        return _array_to_bgr(((array - array.min()) / span * 255.0).astype(np.uint8))
    if image.mode == "F":
        array = np.asarray(image, dtype=np.float64)
        span = float(array.max() - array.min()) or 1.0
        return _array_to_bgr(((array - array.min()) / span * 255.0).astype(np.uint8))
    if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        # Composite on white: transparent PNG text is usually dark-on-nothing.
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        image = Image.alpha_composite(background, rgba)
    rgb = np.asarray(image.convert("RGB"))
    if rgb.size == 0:
        raise ImageLoadError("Image has no pixels.")
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def _array_to_bgr(array):
    array = np.asarray(array)
    if array.dtype != np.uint8:
        array = array.astype(np.float64)
        span = float(array.max() - array.min()) or 1.0
        array = ((array - array.min()) / span * 255.0).astype(np.uint8)
    if array.ndim == 2:
        return cv2.cvtColor(array, cv2.COLOR_GRAY2BGR)
    if array.ndim == 3 and array.shape[2] == 4:
        return cv2.cvtColor(array, cv2.COLOR_BGRA2BGR)
    if array.ndim == 3 and array.shape[2] == 3:
        return array
    raise ImageLoadError(f"Unsupported array shape {array.shape}")
