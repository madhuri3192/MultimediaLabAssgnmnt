"""Score OCR systems on the Task Pipe benchmark (character error rate).

Systems:
  raw       RapidOCR defaults straight on the degraded image (no enhancement,
            default recogniser) - the naive baseline.
  raw_lang  RapidOCR straight on the image, but with the right script model.
  taskpipe  This project's pipeline (enhance -> orient -> OCR).
  legacy    Optional: a module path exposing run_task_pipe() for comparison.

CER = Levenshtein(prediction, truth) / len(truth) after NFKC normalisation,
lines joined with single spaces. `cer_ns` ignores whitespace entirely, so
CJK/Devanagari spacing differences and line-break order do not dominate.

Usage:
  python Cluster05-Task-Pipe/tools/evaluate.py --systems raw,taskpipe
  python Cluster05-Task-Pipe/tools/evaluate.py --systems taskpipe --filter hi_text --show
  python Cluster05-Task-Pipe/tools/evaluate.py --real --systems raw,taskpipe --show

--real scores the photos in <data>/real instead: scenes contain more text
than anyone transcribes, so the metric is key-phrase recall (a phrase counts
as found when some part of the output matches it with <= 20% edits, ignoring
case and whitespace).
"""

import argparse
import importlib.util
import json
import re
import statistics
import sys
import tempfile
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Cluster05-Task-Pipe"))
sys.path.insert(0, str(ROOT))


def normalise(text, keep_spaces=True):
    text = unicodedata.normalize("NFKC", text or "")
    text = re.sub(r"\s+", " " if keep_spaces else "", text).strip()
    return text


def levenshtein(a, b):
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def cer(prediction, truth, keep_spaces=True):
    p, t = normalise(prediction, keep_spaces), normalise(truth, keep_spaces)
    return min(1.0, levenshtein(p, t) / max(1, len(t)))


def fuzzy_distance(needle, haystack):
    """Fewest edits turning `needle` into any substring of `haystack` (Sellers)."""
    previous = [0] * (len(haystack) + 1)
    for i, cn in enumerate(needle, 1):
        current = [i]
        for j, ch in enumerate(haystack, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (cn != ch)))
        previous = current
    return min(previous)


def key_found(key, prediction, tolerance=0.2):
    k = normalise(key, keep_spaces=False).casefold()
    p = normalise(prediction, keep_spaces=False).casefold()
    return fuzzy_distance(k, p) <= tolerance * len(k)


def evaluate_real(args, factories, names):
    data = Path(args.data) / "real"
    truth = json.loads((data / "ground_truth.json").read_text(encoding="utf-8"))
    items = sorted(truth.items())
    if args.filter:
        items = [(k, v) for k, v in items if re.search(args.filter, k)]
    totals = defaultdict(lambda: [0, 0, 0.0])
    rows = []
    for name in names:
        run = factories[name]()
        for image, meta in items:
            started = time.perf_counter()
            try:
                prediction = run(data / image, meta["lang"].split(","))
            except Exception as exc:
                prediction = f"<error {type(exc).__name__}: {exc}>"
            elapsed = time.perf_counter() - started
            found = [key for key in meta["keys"] if key_found(key, prediction)]
            missed = [key for key in meta["keys"] if key not in found]
            totals[name][0] += len(found)
            totals[name][1] += len(meta["keys"])
            totals[name][2] += elapsed
            rows.append({"system": name, "image": image, "found": len(found), "keys": len(meta["keys"]),
                         "missed": missed, "prediction": prediction, "seconds": elapsed})
            print(f"[{name}] {image}: {len(found)}/{len(meta['keys'])} keys, {elapsed:.1f}s"
                  + (f"  missed: {missed}" if missed else ""))
            if args.show:
                print("    " + normalise(prediction)[:300])
    print("\nsystem        keys found   recall   mean_s")
    for name in names:
        found, total, seconds = totals[name]
        print(f"{name:<12}{found:>7}/{total:<5}{found / max(1, total):>8.1%}{seconds / max(1, len(items)):>9.2f}")
    if args.report:
        Path(args.report).write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


# ------------------------------------------------------------------ systems

def system_raw(lang_aware):
    from taskpipe.ocr import OcrEngine
    engines = {}

    def run(path, langs):
        import cv2
        from rapidocr import RapidOCR
        key = tuple(langs) if lang_aware else ("default",)
        if key not in engines:
            if lang_aware:
                model = OcrEngine.models_for_langs(langs)[0]
                engines[key] = RapidOCR(params={"Global.log_level": "error", **model.params()})
            else:
                engines[key] = RapidOCR(params={"Global.log_level": "error"})
        result = engines[key](cv2.imread(str(path)))
        return "\n".join(result.txts or [])
    return run


def system_taskpipe():
    from taskpipe.pipeline import TaskPipe
    pipe = TaskPipe()

    def run(path, langs):
        return pipe.process(path, langs=langs).text
    return run


def system_legacy(module_path):
    spec = importlib.util.spec_from_file_location("legacy_pipeline", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    models = Path(importlib.util.find_spec("rapidocr").origin).parent / "models"
    custom = {"devanagari": "devanagari_PP-OCRv5_rec_mobile.onnx",
              "arabic": "arabic_PP-OCRv5_rec_mobile.onnx",
              "cyrillic": "cyrillic_PP-OCRv5_rec_mobile.onnx",
              "korean": "korean_PP-OCRv5_rec_mobile.onnx"}
    tmp = Path(tempfile.mkdtemp(prefix="legacy-eval-"))
    counter = [0]

    def run(path, langs):
        counter[0] += 1
        rec_lang = module.resolve_rec_lang(langs)
        rec_model = str(models / custom[rec_lang]) if rec_lang in custom else None
        report, _ = module.run_task_pipe(str(path), tmp / f"run{counter[0]}", langs=langs,
                                         rec_model=rec_model)
        return report["text"]
    return run


# ------------------------------------------------------------------ main

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", default=str(ROOT / "datasets" / "task-pipe"))
    parser.add_argument("--systems", default="raw,taskpipe")
    parser.add_argument("--legacy", default=None, help="Path to a legacy pipeline .py")
    parser.add_argument("--filter", default=None, help="Regex on image path")
    parser.add_argument("--show", action="store_true", help="Print every prediction")
    parser.add_argument("--report", default=None, help="Write per-image JSON results here")
    parser.add_argument("--real", action="store_true", help="Score the real photos (key-phrase recall)")
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    factories = {"raw": lambda: system_raw(False), "raw_lang": lambda: system_raw(True),
                 "taskpipe": system_taskpipe, "legacy": lambda: system_legacy(args.legacy)}
    names = [s.strip() for s in args.systems.split(",") if s.strip()]
    if args.real:
        return evaluate_real(args, factories, names)

    data = Path(args.data)
    truth = json.loads((data / "ground_truth.json").read_text(encoding="utf-8"))
    items = sorted(truth.items())
    if args.filter:
        items = [(k, v) for k, v in items if re.search(args.filter, k)]
    rows = []
    for name in names:
        run = factories[name]()
        for key, meta in items:
            langs = meta["lang"].split(",")
            started = time.perf_counter()
            try:
                prediction = run(data / key, langs)
                error = None
            except Exception as exc:  # keep scoring; record the failure
                prediction, error = "", f"{type(exc).__name__}: {exc}"
            elapsed = time.perf_counter() - started
            row = {"system": name, "image": key, "lang": meta["lang"], "card": meta["card"],
                   "degradation": meta["degradation"], "prediction": prediction, "error": error,
                   "cer": cer(prediction, meta["text"]), "cer_ns": cer(prediction, meta["text"], False),
                   "seconds": elapsed}
            rows.append(row)
            if args.show or error:
                flag = f"  !! {error[:120]}" if error else ""
                print(f"[{name}] {key}: cer={row['cer']:.3f} ns={row['cer_ns']:.3f} "
                      f"{elapsed:.1f}s :: {normalise(prediction)[:90]}{flag}")

    def table(group_key):
        groups = defaultdict(lambda: defaultdict(list))
        for row in rows:
            groups[row[group_key]][row["system"]].append(row["cer_ns"])
        header = f"{group_key:<14}" + "".join(f"{n:>12}" for n in names)
        print("\n" + header + "\n" + "-" * len(header))
        for group in sorted(groups):
            cells = "".join(f"{statistics.mean(groups[group][n]):>12.3f}" if groups[group][n] else f"{'-':>12}"
                            for n in names)
            print(f"{group:<14}{cells}")

    table("degradation")
    table("lang")
    print("\nsystem        mean_cer  mean_cer_ns  exact(ns<=2%)  mean_s  errors")
    for name in names:
        mine = [r for r in rows if r["system"] == name]
        if not mine:
            continue
        exact = sum(r["cer_ns"] <= 0.02 for r in mine)
        print(f"{name:<12}{statistics.mean(r['cer'] for r in mine):>10.3f}"
              f"{statistics.mean(r['cer_ns'] for r in mine):>13.3f}"
              f"{exact:>9}/{len(mine):<5}{statistics.mean(r['seconds'] for r in mine):>8.2f}"
              f"{sum(1 for r in mine if r['error']):>8}")
    if args.report:
        Path(args.report).write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
