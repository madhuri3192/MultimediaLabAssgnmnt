"""Task Pipe: enhance a degraded image, fix its geometry, then OCR it.

Stages (each one is recorded in `PipeResult.steps`):

 1. load       EXIF orientation, alpha, 16-bit, first frame
 2. scale      shrink huge photos / enlarge tiny images
 3. enhance    adaptive denoise, shadow removal, exposure, contrast,
               saturation, sharpening (only what the measurements call for)
 4. dewarp     flatten a page/card photographed at an angle
 5. detect     text-line detection (PP-OCRv6, multilingual) on the enhanced
               and the original image, boxes merged
 6. orient     90/270 from line shape, 0/180 from recognition confidence
 7. text size  enlarge when detected text is too small to read
 8. deskew     straighten small rotations using the detected lines
 9. recognise  per line: choose the script model, then the best of several
               renderings (original/enhanced/grey/binary, plus a blind
               deconvolution for blurry images whose blur kernel is chosen
               by recognition confidence)
10. layout     reading order (top-down; right-to-left for Arabic rows)
"""

import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import enhance as enh
from .geometry import (crop_quad, find_document_quad, quad_size, rotate_bound, skew_angle,
                       transform_quads, vertical_fraction, warp_document)
from .imageio import load_image
from .ocr import OcrEngine, Reading, is_rtl, parse_langs, reading_strength


@dataclass
class Line:
    text: str
    confidence: float
    box: list
    model: str
    variant: str


@dataclass
class PipeResult:
    source: str
    text: str
    lines: list
    languages: list
    models: list
    metrics: dict
    steps: list
    rotation: int = 0          # clockwise degrees applied to the input (0/90/180/270)
    skew: float = 0.0          # small-angle correction applied, degrees
    dewarped: bool = False
    inverted_output: bool = False
    seconds: float = 0.0
    enhanced_image: np.ndarray = field(default=None, repr=False)
    visualization: np.ndarray = field(default=None, repr=False)

    @property
    def mean_confidence(self):
        return round(float(np.mean([l.confidence for l in self.lines])), 4) if self.lines else 0.0

    def to_dict(self):
        return {
            "source": self.source,
            "text": self.text,
            "mean_confidence": self.mean_confidence,
            "line_count": len(self.lines),
            "languages": self.languages,
            "recognisers": self.models,
            "rotation_clockwise": self.rotation,
            "skew_corrected_degrees": round(self.skew, 2),
            "dewarped": self.dewarped,
            "inverted_output": self.inverted_output,
            "enhancement_steps": self.steps,
            "image_metrics": self.metrics,
            "seconds": round(self.seconds, 3),
            "lines": [{"text": l.text, "confidence": round(l.confidence, 4), "recogniser": l.model,
                       "variant": l.variant, "box": [[round(float(x), 1), round(float(y), 1)] for x, y in l.box]}
                      for l in self.lines],
        }


class TaskPipe:
    def __init__(self, langs="auto", engine=None, rotate=True, dewarp=True, deskew=True,
                 max_side=2000, min_confidence=0.5, use_variants=True):
        self.langs = parse_langs(langs)
        self.engine = engine or OcrEngine()
        self.rotate = rotate
        self.dewarp = dewarp
        self.deskew = deskew
        self.max_side = max_side
        self.min_confidence = min_confidence
        self.use_variants = use_variants

    @staticmethod
    def validate_langs(langs):
        """Raise OcrError early for unknown language codes."""
        return OcrEngine.models_for_langs(langs)

    # ------------------------------------------------------------------ API

    def process(self, source, langs=None, on_stage=None):
        """Run the pipeline. `on_stage(name)` is called as each stage starts."""
        started = time.perf_counter()
        stage = on_stage or (lambda name: None)
        stage("loading")
        langs = parse_langs(langs) if langs is not None else self.langs
        models = self.engine.models_for_langs(langs)
        original = load_image(source)
        steps = []

        # 2. scale
        original = self._normalise_size(original, steps)

        # 3. photometric enhancement
        stage("enhancing")
        enhanced, enhance_steps, metrics = enh.enhance(original)
        steps.extend(enhance_steps)

        # 4. dewarp (perspective)
        dewarped = False
        if self.dewarp:
            quad = find_document_quad(enhanced)
            if quad is not None:
                enhanced, matrix = warp_document(enhanced, quad)
                original = cv2.warpPerspective(original, matrix, enhanced.shape[1::-1],
                                               flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
                dewarped = True
                steps.append("perspective_dewarp (page/card quad found)")

        # 5. detect
        stage("detecting text")
        boxes = self._detect(enhanced, original, steps)

        # 6a. 90/270: lines taller than wide -> turn the image sideways
        rotation_ccw = 0
        if self.rotate and len(boxes) and vertical_fraction(boxes) > 0.5:
            enhanced, _ = rotate_bound(enhanced, 90)
            original, _ = rotate_bound(original, 90)
            rotation_ccw = 90
            boxes = self._detect(enhanced, original, steps)
            steps.append("rotate 90 (text lines were vertical)")

        # 7. text too small -> enlarge
        if len(boxes):
            heights = [min(quad_size(b)) for b in boxes]
            median_height = float(np.median(heights))
            if median_height < 18:
                factor = float(min(3.0, 30.0 / max(median_height, 1.0)))
                enhanced = cv2.resize(enhanced, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
                original = cv2.resize(original, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
                boxes = boxes * factor
                steps.append(f"upscale x{factor:.2f} (text height {median_height:.0f}px)")

        # 8. deskew
        skew = 0.0
        if self.deskew and len(boxes):
            angle = skew_angle(boxes)
            if 0.8 <= abs(angle) <= 45:
                enhanced, matrix = rotate_bound(enhanced, -angle)
                original, _ = rotate_bound(original, -angle)
                boxes = transform_quads(boxes, matrix)
                skew = -angle
                steps.append(f"deskew {-angle:+.1f} deg")

        stage("choosing languages")
        # 9a. per-line recogniser choice (doubles as the "upright" orientation vote)
        base = []
        if len(boxes):
            base = self.engine.best_model_per_line(self._polarity_crops(enhanced, boxes), models)

        # 6b. 0 vs 180: are the largest lines read better when flipped?
        if self.rotate and len(boxes):
            areas = [np.prod(quad_size(b)) for b in boxes]
            top = list(np.argsort(areas)[::-1][:6])
            flipped_crops = [cv2.rotate(c, cv2.ROTATE_180) for c in self._polarity_crops(enhanced, boxes[top])]
            flipped = self.engine.best_model_per_line(flipped_crops, models)
            score_up = _orientation_score([base[i] for i in top])
            score_flip = _orientation_score(flipped)
            if score_flip > score_up * 1.15 + 0.5:
                enhanced, matrix = rotate_bound(enhanced, 180)
                original, _ = rotate_bound(original, 180)
                # A 180 turn maps top-left onto bottom-right: restore corner order.
                boxes = transform_quads(boxes, matrix)[:, [2, 3, 0, 1]]
                rotation_ccw = (rotation_ccw + 180) % 360
                steps.append(f"rotate 180 (upside-down: {score_flip:.1f} vs {score_up:.1f})")
                base = self.engine.best_model_per_line(self._polarity_crops(enhanced, boxes), models)

        # 9b. recognise
        stage("reading text")
        lines = self._recognise(original, enhanced, boxes, base, models, metrics, steps) if len(boxes) else []

        # 10. layout
        lines = order_lines(lines)
        text = "\n".join(_join_rows(lines))

        # Output image: dark text on light when the page is a grey negative.
        inverted_output = False
        output = enhanced
        if not metrics["dark_text"] and metrics["saturation"] < 40:
            output = cv2.bitwise_not(enhanced)
            inverted_output = True
            steps.append("invert (light text on dark background)")
        return PipeResult(
            source=str(source) if not isinstance(source, np.ndarray) else "<array>",
            text=text, lines=lines, languages=langs, models=[m.name for m in models],
            metrics=metrics, steps=steps, rotation=(360 - rotation_ccw) % 360, skew=skew,
            dewarped=dewarped, inverted_output=inverted_output,
            seconds=time.perf_counter() - started, enhanced_image=output,
            visualization=draw_lines(output, lines))

    # ------------------------------------------------------------ internals

    def _normalise_size(self, image, steps):
        h, w = image.shape[:2]
        if max(h, w) > self.max_side:
            factor = self.max_side / max(h, w)
            steps.append(f"downscale x{factor:.2f} ({w}x{h})")
            return cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
        if min(h, w) < 400:
            factor = min(3.0, 400.0 / max(1, min(h, w)), self.max_side / max(h, w))
            if factor > 1.05:
                steps.append(f"upscale x{factor:.2f} ({w}x{h})")
                return cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        return image

    def _detect(self, enhanced, original, steps):
        """Detect on the enhanced AND the original image and merge the boxes,
        so enhancement can add lines (dark/low-contrast text) but never lose
        one it happened to wash out."""
        boxes, _ = self.engine.detect(enhanced)
        extra, _ = self.engine.detect(original)
        merged = merge_boxes(boxes, extra)
        if len(merged) > len(boxes) and len(boxes):
            steps.append(f"detection: +{len(merged) - len(boxes)} line(s) found only in the original")
        if len(merged):
            return merged
        boxes, _ = self.engine.detect(cv2.bitwise_not(enhanced))
        if len(boxes):
            steps.append("detection fallback: inverted image")
        return boxes

    @staticmethod
    def _polarity_crops(image, boxes):
        crops = []
        for box in boxes:
            crop = crop_quad(image, box)
            crops.append(enh.normalise_polarity(crop)[0])
        return crops

    def _recognise(self, original, enhanced, boxes, base, models, metrics, steps):
        enhanced_crops = [crop_quad(enhanced, b) for b in boxes]
        original_crops = [crop_quad(original, b) for b in boxes]
        if self.use_variants:
            readings = self._best_variants(original_crops, enhanced_crops, base, models, metrics, steps)
        else:
            readings = [(r, "enhanced") for r in base]
        lines = []
        for box, (reading, variant) in zip(boxes, readings):
            text = reading.text.strip()
            if not text or reading.confidence < self.min_confidence:
                continue
            visible = len(text.replace(" ", ""))
            if visible <= 1 and reading.confidence < 0.85:
                continue  # lone low-confidence glyphs are usually noise
            lines.append(Line(text, float(reading.confidence), np.asarray(box).tolist(), reading.model, variant))
        return lines

    def _choose_deblur_kernel(self, original_crops, base, model_lookup, max_lines=3, min_gain=0.02):
        """Blind deblur: try candidate PSFs on the largest lines, keep the one
        that raises recognition confidence clearly (wrong PSFs lower it)."""
        order = [i for i in np.argsort([c.shape[0] * c.shape[1] for c in original_crops])[::-1]
                 if base[i].text][:max_lines]
        if not order:
            return None, ""
        # Unclipped grey: Richardson-Lucy assumes a linear blur model.
        grays = [enh.to_deblur_scale(enh.to_gray(enh.normalise_polarity(original_crops[i])[0])) for i in order]
        height = float(np.median([g.shape[0] for g in grays]))

        def mean_conf(images):
            by_model = {}
            for i, image in zip(order, images):
                by_model.setdefault(base[i].model, []).append(enh.to_bgr(enh.stretch_levels(image, 2, 98)[0]))
            confs = [conf for name, crops in by_model.items()
                     for _, conf in self.engine.recognize(crops, model_lookup[name])]
            return float(np.mean(confs))

        def score(params):
            kernel = enh.psf_from_params(params)
            return mean_conf([enh.deconvolve(g, kernel) for g in grays])

        # Coarse grid, then refine around the two best (RL is length-sensitive).
        coarse = sorted(((score(p), label, p) for label, p in enh.deblur_candidates(height)),
                        key=lambda t: t[0], reverse=True)
        scored = coarse[:2]
        for _, _, params in coarse[:2]:
            scored += [(score(p), label, p) for label, p in enh.refine_params(params)]
        best_score, label, params = max(scored, key=lambda t: t[0]) if scored else (0.0, "", None)
        if params is None or best_score < mean_conf(grays) + min_gain:
            return None, ""
        return enh.psf_from_params(params), label

    def _best_variants(self, original_crops, enhanced_crops, base, models, metrics, steps):
        """Re-read each line from several renderings with its chosen model."""
        model_lookup = {m.name: m for m in models}
        kernel = None
        if metrics["blur"] < 15:
            kernel, label = self._choose_deblur_kernel(original_crops, base, model_lookup)
            if kernel is not None:
                steps.append(f"deconvolve {label} (chosen by recognition confidence)")
        by_model = {}
        for index, reading in enumerate(base):
            variants = enh.line_variants(original_crops[index], enhanced_crops[index], deblur_kernel=kernel)
            for name, crop in variants.items():
                by_model.setdefault(reading.model, []).append((index, name, crop))
        candidates = {i: [] for i in range(len(base))}
        for model_name, items in by_model.items():
            results = self.engine.recognize([crop for _, _, crop in items], model_lookup[model_name])
            for (index, name, _), (text, conf) in zip(items, results):
                candidates[index].append((name, text.strip(), conf))
        chosen = []
        for index, reading in enumerate(base):
            options = candidates[index] + [("enhanced", reading.text, reading.confidence)]
            # Agreement between renderings is strong evidence; then confidence.
            votes = {}
            for name, text, conf in options:
                if not text:
                    continue
                entry = votes.setdefault(text, {"count": 0, "best": 0.0, "variant": name})
                entry["count"] += 1
                if conf > entry["best"]:
                    entry["best"], entry["variant"] = conf, name
            if not votes:
                chosen.append((Reading("", 0.0, reading.model), "none"))
                continue
            text, entry = max(votes.items(), key=lambda kv: kv[1]["best"] + 0.02 * (kv[1]["count"] - 1))
            chosen.append((Reading(text, entry["best"], reading.model), entry["variant"]))
        return chosen


def merge_boxes(primary, secondary, overlap=0.3):
    """Union of two quad sets; secondary quads overlapping a primary one
    (intersection over the smaller area > `overlap`) are dropped."""
    primary = np.asarray(primary, np.float32).reshape(-1, 4, 2)
    secondary = np.asarray(secondary, np.float32).reshape(-1, 4, 2)
    if not len(secondary):
        return primary
    if not len(primary):
        return secondary
    kept = list(primary)
    for quad in secondary:
        area = cv2.contourArea(quad)
        duplicate = False
        for other in kept:
            inter, _ = cv2.intersectConvexConvex(quad, other)
            if inter > overlap * max(1.0, min(area, cv2.contourArea(other))):
                duplicate = True
                break
        if not duplicate:
            kept.append(quad)
    return np.asarray(kept, np.float32)


def _orientation_score(readings):
    """Confident, long readings dominate; upside-down text reads as short junk."""
    return sum(reading_strength(r.text, r.confidence) * r.confidence for r in readings)


# ------------------------------------------------------------------ layout

def order_lines(lines):
    """Sort lines into rows (top-down); left-to-right, or right-to-left for RTL."""
    if not lines:
        return []
    info = []
    for line in lines:
        pts = np.asarray(line.box, np.float32).reshape(-1, 2)
        y0, y1 = float(pts[:, 1].min()), float(pts[:, 1].max())
        info.append((line, y0, y1, (y0 + y1) / 2.0, float(pts[:, 0].mean())))
    info.sort(key=lambda t: t[3])
    rows = []
    for item in info:
        line, y0, y1, cy, cx = item
        if rows:
            last = rows[-1]
            ry0 = min(t[1] for t in last)
            ry1 = max(t[2] for t in last)
            overlap = min(y1, ry1) - max(y0, ry0)
            if overlap > 0.5 * min(y1 - y0, ry1 - ry0):
                last.append(item)
                continue
        rows.append([item])
    ordered = []
    for row_index, row in enumerate(rows):
        rtl = sum(is_rtl(t[0].text) for t in row) > len(row) / 2
        row.sort(key=lambda t: -t[4] if rtl else t[4])
        for item in row:
            item[0].row = row_index
            ordered.append(item[0])
    return ordered


def _join_rows(lines):
    rows = {}
    for line in lines:
        rows.setdefault(getattr(line, "row", 0), []).append(line.text)
    return [" ".join(texts) for _, texts in sorted(rows.items())]


def draw_lines(image, lines):
    vis = image.copy()
    thickness = max(2, int(round(max(vis.shape[:2]) / 600)))
    for index, line in enumerate(lines, 1):
        pts = np.asarray(line.box, np.int32).reshape(-1, 2)
        colour = (0, 160, 0) if line.confidence >= 0.85 else (0, 140, 255) if line.confidence >= 0.65 else (0, 0, 230)
        cv2.polylines(vis, [pts], True, colour, thickness)
        label = f"{index}:{line.confidence:.2f}"
        x, y = int(pts[:, 0].min()), int(pts[:, 1].min())
        scale = max(0.5, thickness / 3.0)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
        y = max(th + 4, y - 4)
        cv2.rectangle(vis, (x, y - th - 4), (x + tw + 4, y + 2), colour, -1)
        cv2.putText(vis, label, (x + 2, y - 2), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 1, cv2.LINE_AA)
    return vis


def save_outputs(result, directory):
    """Write enhanced.png, ocr_boxes.png, text.txt, report.json into `directory`."""
    import json
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(directory / "enhanced.png"), result.enhanced_image)
    cv2.imwrite(str(directory / "ocr_boxes.png"), result.visualization)
    (directory / "text.txt").write_text(result.text + ("\n" if result.text else ""), encoding="utf-8")
    (directory / "report.json").write_text(json.dumps(result.to_dict(), indent=2, ensure_ascii=False) + "\n",
                                           encoding="utf-8")
    return [directory / n for n in ("enhanced.png", "ocr_boxes.png", "text.txt", "report.json")]
