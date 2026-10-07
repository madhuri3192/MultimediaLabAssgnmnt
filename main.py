"""Capstone: automatically route a local image, audio or video file."""

if __name__ == "__main__":
    try:
        from multimedia.cli import metadata_cli
        from multimedia.metadata import analyze
    except ImportError as exc:
        raise SystemExit(f"Missing Python dependency: {exc}. Run: python -m pip install -r requirements.txt")
    raise SystemExit(metadata_cli(analyze, "Multimedia Systems Lab: consolidated analyzer"))
