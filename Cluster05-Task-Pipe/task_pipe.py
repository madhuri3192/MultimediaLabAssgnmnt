"""Task Pipe CLI: enhance degraded images, then extract (multilingual) text.

For every input image the pipeline measures what is wrong (exposure,
contrast, blur, noise, shadows, inversion, rotation, skew, perspective),
fixes it, and runs OCR with the right script recogniser per text line.

Outputs, one folder per image inside --output-dir (a new directory):
  enhanced.png   corrected image (geometry + photometric enhancement)
  ocr_boxes.png  detected lines with confidence (green >= .85, orange >= .65, red)
  text.txt       extracted text in reading order
  report.json    steps applied, image measurements, per-line text/confidence/box
and summary.json + summary.csv + results.html for the whole run. results.html
shows every script correctly even when the terminal font cannot (--open
opens it in the browser).

Examples:
  python Cluster05-Task-Pipe/task_pipe.py photo.jpg
  python Cluster05-Task-Pipe/task_pipe.py scans/ --langs en,hi --output-dir outputs/scans
  python Cluster05-Task-Pipe/task_pipe.py "images/*.png" --langs auto
"""

import argparse
import csv
import glob
import html
import json
import sys
import threading
import time
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

try:
    from multimedia.common import output_directory
    from taskpipe import TaskPipe, save_outputs
    from taskpipe.imageio import IMAGE_EXTENSIONS, ImageLoadError
    from taskpipe.ocr import OcrError
except ImportError as exc:
    raise SystemExit(f"Missing Python dependency: {exc}. Run: python -m pip install -r requirements.txt")


class Spinner:
    """`| [1/3] photo.jpg - reading text (3.2s)` on stderr while working."""

    def __init__(self, label):
        self.label, self.stage, self.started = label, "starting", time.perf_counter()
        self.enabled = sys.stderr.isatty()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        frames = "|/-\\"
        index = 0
        while not self._stop.wait(0.12):
            elapsed = time.perf_counter() - self.started
            sys.stderr.write(f"\r  {frames[index % 4]} {self.label} - {self.stage} ({elapsed:.1f}s)   ")
            sys.stderr.flush()
            index += 1

    def update(self, stage):
        self.stage = stage

    def __enter__(self):
        if self.enabled:
            self._thread.start()
        else:
            print(f"  processing {self.label} ...", file=sys.stderr, flush=True)
        return self

    def __exit__(self, *exc):
        self._stop.set()
        if self.enabled:
            self._thread.join()
            sys.stderr.write("\r" + " " * 100 + "\r")
            sys.stderr.flush()


def write_html(root, summary):
    """results.html: images + extracted text, rendered by the browser (every
    script displays correctly there, unlike in many terminals)."""
    cards = []
    for item in summary:
        name = html.escape(Path(item["file"]).name)
        if item["status"] != "ok":
            cards.append(f"<section><h2>{name}</h2><p class=err>{html.escape(item['error'])}</p></section>")
            continue
        folder = html.escape(Path(item["output"]).name)
        lines = "".join(f"<li><span>{line['confidence']:.2f}</span> <bdi>{html.escape(line['text'])}</bdi></li>"
                        for line in item["line_details"]) or "<li>No text detected.</li>"
        steps = html.escape(", ".join(item["steps"]) or "no fixes needed")
        cards.append(f"""<section><h2>{name}</h2>
<p class=meta>{item['seconds']}s &middot; rotated {item['rotation_clockwise']}&deg; &middot; {steps}</p>
<div class=imgs><figure><img src="{folder}/enhanced.png"><figcaption>enhanced</figcaption></figure>
<figure><img src="{folder}/ocr_boxes.png"><figcaption>detected text</figcaption></figure></div>
<ol dir=auto>{lines}</ol></section>""")
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>Task Pipe results</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{{font-family:system-ui,"Nirmala UI","Noto Sans","Noto Sans Devanagari",sans-serif;margin:0 auto;max-width:1100px;
padding:16px;background:#f6f6f4;color:#222}}
section{{background:#fff;border-radius:10px;padding:16px;margin:16px 0;box-shadow:0 1px 3px #0002}}
h2{{margin:0 0 4px;font-size:18px}} .meta{{color:#666;font-size:13px}} .err{{color:#b00}}
.imgs{{display:flex;gap:12px;flex-wrap:wrap}} figure{{margin:0;flex:1 1 300px}} img{{width:100%;border-radius:6px}}
figcaption{{font-size:12px;color:#777}} li{{font-size:20px;margin:4px 0}} li span{{font-size:12px;color:#888}}
</style></head><body><h1>Task Pipe results</h1>{''.join(cards)}</body></html>"""
    path = root / "results.html"
    path.write_text(page, encoding="utf-8")
    return path


def collect_inputs(items):
    """Expand files, directories (non-recursive) and glob patterns."""
    found = []
    for item in items:
        path = Path(item)
        if path.is_dir():
            found += sorted(p for p in path.iterdir() if p.suffix.lower() in IMAGE_EXTENSIONS)
        elif path.is_file():
            found.append(path)
        else:
            matches = sorted(Path(p) for p in glob.glob(item) if Path(p).suffix.lower() in IMAGE_EXTENSIONS)
            if not matches:
                raise SystemExit(f"No such image, directory or pattern: {item}")
            found += matches
    unique = []
    for path in found:
        if path.resolve() not in {u.resolve() for u in unique}:
            unique.append(path)
    return unique


def build_parser():
    parser = argparse.ArgumentParser(
        description="Task Pipe: enhance degraded images, then OCR them (multilingual).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Language codes: 'auto' (Latin/CJK + Devanagari + Arabic + Cyrillic + Korean) or e.g. "
               "en, hi, ar, ru, ko, zh, ja, es, fr, de, ta, te, th, el, kn. Combine with commas: en,hi")
    parser.add_argument("inputs", nargs="+", help="Image files, directories or glob patterns")
    parser.add_argument("--output-dir", default="outputs/task-pipe", help="New directory for results")
    parser.add_argument("--langs", default="auto", help="Languages in the images (default: auto)")
    parser.add_argument("--min-confidence", type=float, default=0.5, help="Drop lines below this (default 0.5)")
    parser.add_argument("--max-side", type=int, default=2000, help="Downscale larger images to this (default 2000)")
    parser.add_argument("--no-rotate", action="store_true", help="Do not auto-rotate (90/180/270)")
    parser.add_argument("--no-deskew", action="store_true", help="Do not straighten small skew")
    parser.add_argument("--no-dewarp", action="store_true", help="Do not flatten photographed pages")
    parser.add_argument("--no-variants", action="store_true", help="Faster: read each line once")
    parser.add_argument("--quiet", action="store_true", help="Only print the extracted text")
    parser.add_argument("--open", action="store_true", help="Open results.html in the browser when done")
    return parser


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = build_parser().parse_args(argv)
    inputs = collect_inputs(args.inputs)
    if not inputs:
        raise SystemExit("No images found.")
    try:
        TaskPipe.validate_langs(args.langs)
        root = output_directory(args.output_dir)
    except FileExistsError:
        print(f"Error: {args.output_dir} already exists; choose a new --output-dir "
              "(earlier results are never overwritten).", file=sys.stderr)
        return 2
    except (OcrError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    pipe = TaskPipe(langs=args.langs, rotate=not args.no_rotate, deskew=not args.no_deskew,
                    dewarp=not args.no_dewarp, max_side=args.max_side,
                    min_confidence=args.min_confidence, use_variants=not args.no_variants)
    summary, failures, used_names = [], 0, set()
    for number, path in enumerate(inputs, 1):
        name = path.stem
        while name in used_names:
            name += "_"
        used_names.add(name)
        try:
            with Spinner(f"[{number}/{len(inputs)}] {path.name}") as spinner:
                result = pipe.process(path, on_stage=spinner.update)
        except (ImageLoadError, OcrError, OSError, ValueError) as exc:
            failures += 1
            print(f"[{number}/{len(inputs)}] {path.name}: ERROR {exc}", file=sys.stderr)
            summary.append({"file": str(path), "status": "error", "error": str(exc)})
            continue
        save_outputs(result, root / name)
        summary.append({"file": str(path), "status": "ok", "output": str(root / name),
                        "lines": len(result.lines), "mean_confidence": result.mean_confidence,
                        "rotation_clockwise": result.rotation, "skew": round(result.skew, 2),
                        "recognisers": sorted({l.model for l in result.lines}),
                        "seconds": round(result.seconds, 2), "text": result.text, "steps": result.steps,
                        "line_details": [{"text": l.text, "confidence": round(l.confidence, 4)}
                                         for l in result.lines]})
        if args.quiet:
            print(result.text)
            continue
        print(f"\n[{number}/{len(inputs)}] {path.name}  ->  {root / name}")
        print(f"  steps: {', '.join(result.steps) or 'none needed'}")
        print(f"  {len(result.lines)} line(s), mean confidence {result.mean_confidence:.2f}, "
              f"{result.seconds:.1f}s")
        for line in result.lines:
            print(f"  ({line.confidence:.2f} {line.model}) {line.text}")
        if not result.lines:
            print("  No text detected.")

    page = write_html(root, summary)
    (root / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    with (root / "summary.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=["file", "status", "lines", "mean_confidence",
                                                    "rotation_clockwise", "skew", "seconds", "text", "error"],
                                extrasaction="ignore")
        writer.writeheader()
        writer.writerows(summary)
    if not args.quiet:
        print(f"\nDone: {len(inputs) - failures} ok, {failures} failed. Results in {root}")
        print(f"Text looks broken in this terminal (Hindi, Arabic, ...)? Open {page}")
    if args.open:
        webbrowser.open(page.as_uri())
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
