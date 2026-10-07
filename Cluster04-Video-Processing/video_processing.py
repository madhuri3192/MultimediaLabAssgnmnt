"""Stream video operations; reverse through a temporary raw-frame file.

All AVI outputs are MJPEG at a constant frame rate and contain NO AUDIO.
"""

import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import cv2
    import numpy as np
    from multimedia.cli import processing_cli
    from multimedia.common import MediaError, output_directory, validate_file
    from multimedia.metadata import video_metadata
except ImportError as exc:
    raise SystemExit(f"Missing Python dependency: {exc}. Run: python -m pip install -r requirements.txt")


def save_png(path, frame):
    ok, encoded = cv2.imencode(".png", frame)
    if not ok:
        raise MediaError(f"Could not encode image: {path.name}")
    path.write_bytes(encoded.tobytes())


def process_video(file_name, destination, start=0.0, duration=2.0):
    if not math.isfinite(start) or not math.isfinite(duration) or start < 0 or duration <= 0:
        raise MediaError("Trim start must be finite and nonnegative; duration must be finite and positive.")
    path = validate_file(file_name)
    metadata = video_metadata(path)
    if metadata["duration_seconds"] and start >= metadata["duration_seconds"]:
        raise MediaError("Trim start is beyond the end of the video.")
    capture = cv2.VideoCapture(str(path))
    writers = {}
    try:
        if not capture.isOpened():
            raise MediaError("OpenCV cannot open this video; the decoder may be unavailable.")
        fps = capture.get(cv2.CAP_PROP_FPS)
        ok, first = capture.read()
        if not ok or not math.isfinite(fps) or fps <= 0:
            raise MediaError("Video has no readable frames or valid frame rate.")
        height, width = first.shape[:2]
        if width < 4 or height < 4 or width % 2 or height % 2:
            raise MediaError("Video processing requires even dimensions of at least 4 pixels.")
        # MJPEG requires even dimensions; round the half size down to even.
        half = ((width // 2) // 2 * 2, (height // 2) // 2 * 2)
        directory = output_directory(destination)
        frames_directory = directory / "frames"
        frames_directory.mkdir()
        paths = [directory / f"{name}.avi" for name in ("grayscale", "resize_half", "trimmed", "reversed")]
        for output in paths:
            size = half if output.stem == "resize_half" else (width, height)
            writer = cv2.VideoWriter(str(output), cv2.VideoWriter_fourcc(*"MJPG"), fps, size)
            writers[output.stem] = writer
            if not writer.isOpened():
                raise MediaError("OpenCV MJPEG encoder is unavailable.")
        thumbnail = directory / "thumbnail.png"
        save_png(thumbnail, first)
        paths.append(thumbnail)
        count, trimmed, next_second = 0, 0, 0
        frame_bytes = first.nbytes
        # Disk usage is width * height * 3 * frame_count; RAM is a few frames.
        with tempfile.TemporaryFile(dir=directory) as spool:
            frame = first
            while ok:
                if frame.shape != first.shape:
                    raise MediaError("Video changes resolution midstream.")
                timestamp = count / fps
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                writers["grayscale"].write(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
                writers["resize_half"].write(cv2.resize(frame, half, interpolation=cv2.INTER_AREA))
                if start <= timestamp < start + duration:
                    writers["trimmed"].write(frame)
                    trimmed += 1
                if timestamp >= next_second:
                    representative = frames_directory / f"frame_{count:06d}.png"
                    save_png(representative, frame)
                    paths.append(representative)
                    next_second = math.floor(timestamp) + 1
                spool.write(frame.tobytes())
                count += 1
                ok, frame = capture.read()
            if not trimmed:
                raise MediaError("Trim range contains no decoded frames.")
            expected = metadata["frame_count"]
            if expected and not metadata["frame_count_estimated"] and count != expected:
                raise MediaError(f"Video decoding ended early: read {count} of {expected} frames.")
            for index in range(count - 1, -1, -1):
                spool.seek(index * frame_bytes)
                reversed_frame = np.frombuffer(spool.read(frame_bytes), dtype=np.uint8).reshape(first.shape)
                writers["reversed"].write(reversed_frame)
        for writer in writers.values():
            writer.release()
        for output in paths[:4]:
            check = cv2.VideoCapture(str(output))
            try:
                readable, _ = check.read()
                if not readable:
                    raise MediaError(f"Generated video is unreadable: {output.name}")
            finally:
                check.release()
        return paths
    except cv2.error as exc:
        raise MediaError(f"OpenCV could not process the video: {exc}") from exc
    finally:
        capture.release()
        for writer in writers.values():
            writer.release()


if __name__ == "__main__":
    raise SystemExit(processing_cli(process_video, "Video processing (silent MJPEG AVI outputs)", "outputs/video", video=True))
