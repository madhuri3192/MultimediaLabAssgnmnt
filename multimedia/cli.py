"""Consistent command-line reports and friendly failure exit codes."""

import argparse
import json
import sys

from .common import MediaError, json_safe, readable_report, save_report


def metadata_cli(analyzer, description, standalone=False):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("file", help="Path to a local media file")
    parser.add_argument("--json", metavar="PATH", help="Save JSON to a new file (never overwrite)")
    args = parser.parse_args()
    try:
        report = analyzer(args.file)
        if args.json:
            save_report(report, args.json)
        if standalone:
            print(json.dumps(json_safe(report), indent=2, ensure_ascii=False, allow_nan=False))
        else:
            print(readable_report(report))
        return 0
    except (MediaError, OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


def processing_cli(processor, description, default_output, video=False):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("file", help="Input file")
    parser.add_argument("--output-dir", default=default_output, help="New directory for generated outputs")
    if video:
        parser.add_argument("--start", type=float, default=0.0, help="Trim start in seconds (default: 0)")
        parser.add_argument("--duration", type=float, default=2.0, help="Trim length in seconds (default: 2)")
    args = parser.parse_args()
    try:
        options = {"start": args.start, "duration": args.duration} if video else {}
        for path in processor(args.file, args.output_dir, **options):
            print(f"Saved: {path}")
        return 0
    except (MediaError, OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
