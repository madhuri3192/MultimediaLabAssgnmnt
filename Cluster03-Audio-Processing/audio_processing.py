"""Mono conversion, peak normalization and reversal for 16-bit PCM WAV."""

import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import numpy as np
    from multimedia.cli import processing_cli
    from multimedia.common import MediaError, output_directory, validate_file
    from multimedia.metadata import wav_metadata
except ImportError as exc:
    raise SystemExit(f"Missing Python dependency: {exc}. Run: python -m pip install -r requirements.txt")


def process_audio(file_name, destination):
    path = validate_file(file_name)
    metadata = wav_metadata(path)
    if metadata["sample_width_bits"] != 16 or metadata["channels"] not in (1, 2):
        raise MediaError("Audio processing requires mono or stereo 16-bit PCM WAV.")
    channels = metadata["channels"]
    with wave.open(str(path), "rb") as source:
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").reshape(-1, channels)
    # Widen before abs/averaging: abs(-32768) overflows a signed int16.
    floating = samples.astype(np.float64)
    peak = np.max(np.abs(floating))
    normalized = floating * (32767 / peak) if peak else floating
    outputs = {
        "mono": np.rint(floating.mean(axis=1)).astype("<i2").reshape(-1, 1),
        "normalized": np.clip(np.rint(normalized), -32768, 32767).astype("<i2"),
        "reversed": samples[::-1],  # Reverse frames, preserving channel order.
    }
    directory = output_directory(destination)
    paths = []
    for name, result in outputs.items():
        output = directory / f"{name}.wav"
        with wave.open(str(output), "wb") as target:
            target.setnchannels(result.shape[1])
            target.setsampwidth(2)
            target.setframerate(metadata["sample_rate"])
            target.writeframes(result.tobytes())
        paths.append(output)
    return paths


if __name__ == "__main__":
    raise SystemExit(processing_cli(process_audio, "16-bit PCM WAV processing", "outputs/audio"))
