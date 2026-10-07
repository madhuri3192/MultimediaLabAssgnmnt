"""Six basic image operations, saved as PNG files."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import cv2
    import numpy as np
    from PIL import Image, ImageFilter, ImageOps
    from multimedia.cli import processing_cli
    from multimedia.common import output_directory, validate_file
    from multimedia.metadata import image_metadata
except ImportError as exc:
    raise SystemExit(f"Missing Python dependency: {exc}. Run: python -m pip install -r requirements.txt")


def process_image(file_name, destination):
    path = validate_file(file_name)
    image_metadata(path)
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    gray = ImageOps.grayscale(image)
    outputs = {
        "grayscale": gray,
        "resize_half": image.resize((max(1, image.width // 2), max(1, image.height // 2)), Image.Resampling.LANCZOS),
        "threshold": gray.point(lambda value: 255 if value >= 128 else 0),
        "gaussian_blur": image.filter(ImageFilter.GaussianBlur(radius=2)),
        "canny_edges": Image.fromarray(cv2.Canny(np.asarray(gray), 100, 200)),
        "rotate_clockwise": image.transpose(Image.Transpose.ROTATE_270),
    }
    directory = output_directory(destination)
    paths = []
    for name, result in outputs.items():
        path = directory / f"{name}.png"
        result.save(path, format="PNG")
        paths.append(path)
    return paths


if __name__ == "__main__":
    raise SystemExit(processing_cli(process_image, "Basic image processing", "outputs/images"))
