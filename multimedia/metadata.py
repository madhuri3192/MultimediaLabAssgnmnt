"""Normalize image, audio and video metadata into JSON-compatible dictionaries."""

import wave
import shutil
from fractions import Fraction

from PIL import ExifTags, Image, UnidentifiedImageError

from .common import (IMAGE_EXTENSIONS, MediaError, file_details, json_safe,
                     number, probe, validate_file, video_streams)


def image_metadata(file_name):
    path = validate_file(file_name)
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load()
            exif = image.getexif()
            fields = {ExifTags.TAGS.get(k, str(k)): v for k, v in exif.items()
                      if k not in (34665, 34853, 37500)}
            for ifd, names, label in ((34665, ExifTags.TAGS, "Camera"),
                                      (34853, ExifTags.GPSTAGS, "GPS")):
                if ifd in exif:
                    fields[label] = {names.get(k, str(k)): v for k, v in exif.get_ifd(ifd).items() if k != 37500}
            return json_safe({
                **file_details(path), "media_type": "image", "format": image.format,
                "width": image.width, "height": image.height, "mode": image.mode,
                "dpi": image.info.get("dpi"), "exif": fields,
            })
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as exc:
        hint = " HEIC/HEIF requires a separately registered Pillow decoder." if path.suffix.lower() in {".heic", ".heif"} else ""
        raise MediaError(f"Cannot decode image (corrupt or unsupported): {path.name}.{hint}") from exc


def audio_stream(stream):
    depth = number(stream.get("bits_per_raw_sample"), True) or number(stream.get("bits_per_sample"), True)
    return {
        "index": stream.get("index"), "codec": stream.get("codec_name"),
        "channels": number(stream.get("channels"), True),
        "channel_layout": stream.get("channel_layout"),
        "sample_rate": number(stream.get("sample_rate"), True),
        "sample_width_bits": depth or None,
        "bit_rate": number(stream.get("bit_rate"), True),
        "duration_seconds": number(stream.get("duration")), "tags": stream.get("tags", {}),
    }


def container_name(container):
    name = container.get("format_name")
    return {"mov,mp4,m4a,3gp,3g2,mj2": "MP4 / QuickTime",
            "matroska,webm": "Matroska / WebM"}.get(name, name.upper() if name else None)


def wav_metadata(path):
    try:
        with wave.open(str(path), "rb") as audio:
            channels, width, rate, frames, _, _ = audio.getparams()
            if not rate or not frames:
                raise MediaError("WAV contains no audio frames.")
            # Check payload in bounded chunks, including truncated WAV files.
            remaining = frames
            while remaining:
                count = min(remaining, 65536)
                if len(audio.readframes(count)) != count * channels * width:
                    raise MediaError("WAV audio data is truncated.")
                remaining -= count
        return {**file_details(path), "media_type": "audio", "format": "wav",
                "codec": f"pcm_{'u' if width == 1 else 's'}{width * 8}{'le' if width > 1 else ''}",
                "channels": channels, "sample_width_bits": width * 8,
                "sample_rate": rate, "frames": frames,
                "duration_seconds": round(frames / rate, 6),
                "bit_rate": channels * width * 8 * rate, "tags": {}}
    except (wave.Error, EOFError, OSError) as exc:
        raise MediaError(f"Cannot read PCM WAV: {path.name}") from exc


def audio_metadata(file_name, data=None):
    path = validate_file(file_name)
    if path.suffix.lower() == ".wav" and data is None:
        result = wav_metadata(path)
        # WAV metadata still works without the external dependency.
        if shutil.which("ffprobe"):
            details = probe(path)
            result["tags"] = details.get("format", {}).get("tags", {})
        return result
    data = data if data is not None else probe(path)
    streams = [s for s in data["streams"] if s.get("codec_type") == "audio"]
    if not streams or video_streams(data):
        raise MediaError(f"Expected an audio file: {path.name}")
    container = data.get("format", {})
    primary = audio_stream(streams[0])
    return {**file_details(path), "media_type": "audio", **primary,
            "format": container_name(container),
            "duration_seconds": primary["duration_seconds"] or number(container.get("duration")),
            "bit_rate": primary["bit_rate"] or number(container.get("bit_rate"), True),
            "tags": {**container.get("tags", {}), **primary["tags"]},
            "audio_streams": [audio_stream(s) for s in streams]}


def video_metadata(file_name, data=None):
    path = validate_file(file_name)
    if path.suffix.lower() in IMAGE_EXTENSIONS:
        raise MediaError(f"Expected a video file: {path.name}")
    data = data if data is not None else probe(path)
    streams = video_streams(data)
    if not streams:
        raise MediaError(f"Expected a video file: {path.name}")
    stream, container = streams[0], data.get("format", {})
    fps = None
    for key in ("avg_frame_rate", "r_frame_rate"):
        try:
            fps = number(float(Fraction(stream.get(key, "0/0"))))
            if fps and fps > 0:
                break
        except (ValueError, ZeroDivisionError):
            pass
    duration = number(stream.get("duration")) or number(container.get("duration"))
    frames = number(stream.get("nb_frames"), True)
    estimated = frames is None and bool(fps and duration)
    if estimated:
        frames = round(fps * duration)
    return {**file_details(path), "media_type": "video",
            "container": container_name(container), "duration_seconds": duration,
            "width": number(stream.get("width"), True), "height": number(stream.get("height"), True),
            "frame_rate": fps, "frame_count": frames, "frame_count_estimated": estimated,
            "codec": stream.get("codec_name"), "bit_rate": number(container.get("bit_rate"), True),
            "video_bit_rate": number(stream.get("bit_rate"), True),
            "tags": container.get("tags", {}), "video_tags": stream.get("tags", {}),
            "audio_streams": [audio_stream(s) for s in data["streams"] if s.get("codec_type") == "audio"]}


def detect_media(file_name):
    """Return (type, probe data); verify content after extension validation."""
    path = validate_file(file_name)
    try:
        with Image.open(path):
            return "image", None
    except Image.DecompressionBombError as exc:
        raise MediaError(f"Image exceeds Pillow's safe pixel limit: {path.name}") from exc
    except (UnidentifiedImageError, OSError, ValueError):
        if path.suffix.lower() in IMAGE_EXTENSIONS:
            # Route unreadable images to the decoder's helpful error message.
            return "image", None
    if path.suffix.lower() == ".wav":
        # RIFF/WAVE is checked by wave, keeping PCM WAV independent of FFprobe.
        with path.open("rb") as source:
            header = source.read(12)
        if header[:4] == b"RIFF" and header[8:12] == b"WAVE":
            return "audio", None
    data = probe(path)
    if video_streams(data):
        return "video", data
    if any(s.get("codec_type") == "audio" for s in data["streams"]):
        return "audio", data
    raise MediaError(f"No supported media stream found: {path.name}")


def analyze(file_name):
    kind, data = detect_media(file_name)
    if kind == "image":
        return image_metadata(file_name)
    return {"audio": audio_metadata, "video": video_metadata}[kind](file_name, data)
