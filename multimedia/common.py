"""File validation, FFprobe access and JSON/report helpers."""

import json
import math
import re
import shutil
import subprocess
from pathlib import Path


class MediaError(Exception):
    """An input, dependency or output problem that the CLI can explain."""


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".heic", ".heif"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".opus"}
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".avi", ".mkv", ".webm", ".mpg", ".mpeg", ".ogv"}


def validate_file(file_name):
    path = Path(file_name).expanduser().resolve()
    if not path.is_file():
        raise MediaError(f"File does not exist or is not a regular file: {path}")
    if not path.stat().st_size:
        raise MediaError(f"File is empty: {path.name}")
    if path.suffix.lower() not in IMAGE_EXTENSIONS | AUDIO_EXTENSIONS | VIDEO_EXTENSIONS:
        raise MediaError(f"Unsupported extension: {path.suffix or '(none)'}")
    return path


def file_details(path):
    return {"file_name": path.name, "file_size": path.stat().st_size}


def number(value, integer=False):
    """FFprobe uses strings and N/A for many numeric fields."""
    try:
        result = float(value)
        if not math.isfinite(result):
            return None
        return int(result) if integer else result
    except (TypeError, ValueError, OverflowError):
        return None


def probe(path):
    executable = shutil.which("ffprobe")
    if not executable:
        raise MediaError("FFprobe is missing. Install FFmpeg and add its bin directory to PATH.")
    try:
        result = subprocess.run(
            [executable, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise MediaError(f"Could not run FFprobe: {exc}") from exc
    if result.returncode:
        raise MediaError(f"Cannot read media (corrupt or unsupported): {path.name}")
    try:
        data = json.loads(result.stdout)
        if not isinstance(data, dict) or not isinstance(data.get("streams"), list):
            raise ValueError("missing streams")
        return data
    except (ValueError, TypeError) as exc:
        raise MediaError("FFprobe returned an invalid report.") from exc


def video_streams(data):
    # Album artwork is a video stream too, but does not make a song a video.
    return [s for s in data["streams"] if s.get("codec_type") == "video"
            and not s.get("disposition", {}).get("attached_pic")]


def json_safe(value):
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, bytes):
        decoded = value.decode("utf-8", errors="replace").rstrip("\x00")
        return decoded if decoded.isprintable() or not decoded else "hex: " + value.hex()
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    # Pillow's EXIF rationals are not native JSON numbers.
    try:
        return number(float(value))
    except (TypeError, ValueError, ZeroDivisionError):
        return str(value)


def save_report(report, destination):
    path = Path(destination).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation also protects the input if passed as --json.
    with path.open("x", encoding="utf-8") as output:
        json.dump(json_safe(report), output, indent=2, ensure_ascii=False, allow_nan=False)
        output.write("\n")


def readable_report(report):
    labels = {"file_size": "File size (bytes)", "duration_seconds": "Duration (seconds)",
              "sample_rate": "Sample rate (Hz)", "bit_rate": "Bit rate (bits/s)",
              "video_bit_rate": "Video bit rate (bits/s)", "frame_rate": "Frame rate (fps)",
              "sample_width_bits": "Bit depth", "dpi": "DPI (X, Y)", "exif": "EXIF", "GPS": "GPS"}

    def lines(value, indent=0):
        if isinstance(value, dict):
            for key, item in value.items():
                words = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", key).replace("_", " ")
                label = labels.get(key, words[:1].upper() + words[1:])
                if isinstance(item, (list, tuple)) and item and all(not isinstance(v, (dict, list)) for v in item):
                    yield " " * indent + f"{label}: " + ", ".join(map(str, item))
                    continue
                if isinstance(item, (dict, list)) and item:
                    yield " " * indent + label + ":"
                    yield from lines(item, indent + 2)
                else:
                    display = "Not available" if item is None else item
                    yield " " * indent + f"{label}: {display}"
        elif isinstance(value, list):
            for index, item in enumerate(value, 1):
                yield " " * indent + f"[{index}]"
                yield from lines(item, indent + 2)
        else:
            yield " " * indent + str(value)
    return "\n".join(lines(json_safe(report)))


def output_directory(destination):
    path = Path(destination).expanduser().resolve()
    # Each run has its own directory; never overwrite an earlier experiment.
    path.mkdir(parents=True, exist_ok=False)
    return path
