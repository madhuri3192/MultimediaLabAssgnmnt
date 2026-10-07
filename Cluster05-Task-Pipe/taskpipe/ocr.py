"""OCR engine layer: one shared text detector + per-script text recognisers.

RapidOCR ships the PP-OCRv6 multilingual recogniser (Chinese, English,
Japanese and ~45 Latin-script languages). Other scripts use the PP-OCRv5
script recognisers, which RapidOCR downloads on first use (~8 MB each) into
its models directory.

Every script recogniser also reads Latin text, and confidences are not
comparable across models (the multi model reads Cyrillic as blank spaces with
0.97 confidence). So a script model's reading only competes for a line when
it actually contains characters of that script.
"""

import logging
import re
import unicodedata
from dataclasses import dataclass, field

import numpy as np


class OcrError(Exception):
    """OCR backend missing, model download failed, etc."""


@dataclass(frozen=True)
class RecModel:
    name: str
    lang_type: str
    ocr_version: str  # "PP-OCRv6" (bundled) | "PP-OCRv5" | "PP-OCRv4"
    model_type: str
    script: str  # Unicode script that proves this model is the right one

    def params(self):
        """RapidOCR constructor params selecting this recogniser."""
        if self.name == "multi":
            return {}
        from rapidocr import LangRec, ModelType, OCRVersion
        return {"Rec.ocr_version": OCRVersion(self.ocr_version),
                "Rec.lang_type": LangRec(self.lang_type),
                "Rec.model_type": ModelType(self.model_type)}


MODELS = {
    "multi": RecModel("multi", "ch", "PP-OCRv6", "small", "latin_cjk"),
    "devanagari": RecModel("devanagari", "devanagari", "PP-OCRv5", "mobile", "devanagari"),
    "arabic": RecModel("arabic", "arabic", "PP-OCRv5", "mobile", "arabic"),
    "cyrillic": RecModel("cyrillic", "cyrillic", "PP-OCRv5", "mobile", "cyrillic"),
    "korean": RecModel("korean", "korean", "PP-OCRv5", "mobile", "hangul"),
    "greek": RecModel("greek", "el", "PP-OCRv5", "mobile", "greek"),
    "thai": RecModel("thai", "th", "PP-OCRv5", "mobile", "thai"),
    "tamil": RecModel("tamil", "ta", "PP-OCRv5", "mobile", "tamil"),
    "telugu": RecModel("telugu", "te", "PP-OCRv5", "mobile", "telugu"),
    "kannada": RecModel("kannada", "ka", "PP-OCRv4", "mobile", "kannada"),
}

# ISO 639-1/-3 codes (and a few names) -> recogniser.
LANG_TO_MODEL = {
    **{code: "multi" for code in (
        "en", "eng", "zh", "ch", "chi_sim", "zh-cn", "zh-tw", "chinese", "ja", "jpn", "japan",
        "es", "spa", "fr", "fra", "de", "deu", "it", "ita", "pt", "por", "nl", "pl", "ro", "tr",
        "vi", "id", "ms", "sv", "da", "no", "fi", "cs", "sk", "sl", "hr", "hu", "et", "lv", "lt",
        "ca", "eu", "gl", "ga", "cy", "is", "sq", "af", "sw", "tl", "la", "latin")},
    **{code: "devanagari" for code in ("hi", "hin", "mr", "mar", "ne", "nep", "sa", "san", "devanagari")},
    **{code: "arabic" for code in ("ar", "ara", "fa", "fas", "ur", "urd", "ug", "arabic")},
    **{code: "cyrillic" for code in ("ru", "rus", "uk", "ukr", "be", "bg", "bul", "sr", "mk", "kk",
                                     "mn", "cyrillic")},
    **{code: "korean" for code in ("ko", "kor", "korean")},
    **{code: "greek" for code in ("el", "ell", "greek")},
    **{code: "thai" for code in ("th", "tha", "thai")},
    **{code: "tamil" for code in ("ta", "tam", "tamil")},
    **{code: "telugu" for code in ("te", "tel", "telugu")},
    **{code: "kannada" for code in ("kn", "kan", "kannada")},
}
# Used when the caller does not know the language(s) in the image.
AUTO_MODELS = ("multi", "devanagari", "arabic", "cyrillic", "korean")

_SCRIPT_RANGES = {
    "devanagari": [(0x0900, 0x097F), (0xA8E0, 0xA8FF)],
    "arabic": [(0x0600, 0x06FF), (0x0750, 0x077F), (0x08A0, 0x08FF), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)],
    "cyrillic": [(0x0400, 0x052F)],
    "hangul": [(0x1100, 0x11FF), (0x3130, 0x318F), (0xAC00, 0xD7AF)],
    "greek": [(0x0370, 0x03FF)],
    "thai": [(0x0E00, 0x0E7F)],
    "tamil": [(0x0B80, 0x0BFF)],
    "telugu": [(0x0C00, 0x0C7F)],
    "kannada": [(0x0C80, 0x0CFF)],
}
RTL_SCRIPTS = {"arabic"}


def parse_langs(raw):
    """'en,hi' / 'en+hi' / ['en', 'hi'] / None|'auto' -> ['en', 'hi'] | ['auto']."""
    if raw is None:
        return ["auto"]
    if isinstance(raw, str):
        raw = raw.replace("+", ",").split(",")
    langs = [str(part).strip().lower() for part in raw if str(part).strip()]
    return langs or ["auto"]


def script_share(text, script):
    """Fraction of letters in `text` that belong to `script`."""
    letters = [ch for ch in text if ch.isalpha() or unicodedata.category(ch).startswith("M")]
    if not letters:
        return 0.0
    ranges = _SCRIPT_RANGES.get(script)
    if ranges is None:  # multi model: everything it can emit is "its" script
        return 1.0
    hits = sum(1 for ch in letters if any(lo <= ord(ch) <= hi for lo, hi in ranges))
    return hits / len(letters)


def is_rtl(text):
    return script_share(text, "arabic") > 0.5


# Cyrillic/Greek letters and the Latin glyphs (or digits) a Latin-only model
# mistakes them for. Both readings are reduced to this skeleton to tell a
# genuine Latin word from a Cyrillic/Greek word read as look-alikes.
_HOMOGLYPHS = str.maketrans({
    "а": "a", "б": "6", "в": "b", "г": "r", "д": "g", "е": "e", "ё": "e", "ж": "x", "з": "3", "и": "u",
    "й": "u", "к": "k", "л": "n", "м": "m", "н": "h", "о": "o", "п": "n", "р": "p", "с": "c", "т": "t",
    "у": "y", "ф": "o", "х": "x", "ц": "u", "ч": "4", "ш": "w", "щ": "w", "ъ": "b", "ы": "bi", "ь": "b",
    "э": "3", "ю": "io", "я": "r", "і": "i", "ї": "i", "є": "e",
    "α": "a", "β": "b", "γ": "y", "ε": "e", "η": "n", "ι": "i", "κ": "k", "μ": "u", "ν": "v", "ο": "o",
    "π": "n", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w",
})
_LOOKALIKE_SCRIPTS = {"cyrillic", "greek"}


def glyph_skeleton(text):
    return re.sub(r"[\s.,:;'\"-]+", "", text.casefold().translate(_HOMOGLYPHS))


def is_lookalike(script_text, latin_text):
    """True when `latin_text` is `script_text` spelled with Latin look-alikes."""
    a, b = glyph_skeleton(script_text), glyph_skeleton(latin_text)
    if not a or not b:
        return False
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1] <= 0.4 * max(len(a), len(b))


def reading_strength(text, conf):
    """Confidence-weighted visible length (spaces carry no evidence)."""
    return conf * len(re.sub(r"\s+", "", text))


@dataclass
class Reading:
    text: str
    confidence: float
    model: str
    variant: str = ""
    alternatives: list = field(default_factory=list)


class OcrEngine:
    """Lazily created RapidOCR detector/recognisers, shared across images."""

    def __init__(self, det_model_type="small", quiet=True):
        self.det_model_type = det_model_type
        self.quiet = quiet
        self._engines = {}

    # ------------------------------------------------------------ models

    @staticmethod
    def models_for_langs(langs):
        """Resolve requested languages to the recognisers to run."""
        langs = parse_langs(langs)
        if "auto" in langs:
            names = list(AUTO_MODELS)
        else:
            unknown = [lang for lang in langs if lang not in LANG_TO_MODEL]
            if unknown:
                raise OcrError(f"Unsupported language code(s): {', '.join(unknown)}. "
                               f"Known: {', '.join(sorted(set(LANG_TO_MODEL)))} or 'auto'.")
            names = []
            for lang in langs:
                name = LANG_TO_MODEL[lang]
                if name not in names:
                    names.append(name)
            # Digits/Latin words appear in every script; the multi model reads
            # them best, so it is always available as a fallback.
            if "multi" not in names:
                names.append("multi")
        return [MODELS[name] for name in names]

    def _engine(self, model):
        if model.name not in self._engines:
            try:
                from rapidocr import ModelType, RapidOCR
            except ImportError as exc:
                raise OcrError("RapidOCR is missing. Run: python -m pip install -r requirements.txt") from exc
            params = {"Global.log_level": "error" if self.quiet else "info",
                      "Det.model_type": ModelType(self.det_model_type), **model.params()}
            if self.quiet:
                logging.getLogger("RapidOCR").setLevel(logging.ERROR)
            try:
                self._engines[model.name] = RapidOCR(params=params)
            except Exception as exc:  # download failures, bad model files
                raise OcrError(f"Could not load the '{model.name}' recogniser ({exc}). The first use of a "
                               "script model downloads it; check the network connection.") from exc
        return self._engines[model.name]

    # ------------------------------------------------------------ inference

    def detect(self, image_bgr):
        """Text-line quads (N, 4, 2) float32 in image coordinates + det scores."""
        result = self._engine(MODELS["multi"]).text_det(image_bgr)
        if result.boxes is None or len(result.boxes) == 0:
            return np.zeros((0, 4, 2), np.float32), np.zeros((0,), np.float32)
        return np.asarray(result.boxes, np.float32).reshape(-1, 4, 2), np.asarray(result.scores, np.float32)

    def recognize(self, crops, model):
        """Recognise a list of BGR line crops -> [(text, confidence)]."""
        if not crops:
            return []
        from rapidocr.ch_ppocr_rec import TextRecInput
        result = self._engine(model).text_rec(TextRecInput(img=list(crops)))
        texts = list(result.txts or [])
        scores = [float(s) for s in (result.scores or [])]
        scores += [0.0] * (len(texts) - len(scores))
        return [(t or "", s) for t, s in zip(texts, scores)]

    def best_model_per_line(self, crops, models):
        """Run every recogniser on every crop and keep the right one per line.

        Returns [Reading]. A script model is eligible only if at least 30% of
        the letters it read belong to its script; among eligible readings the
        strongest (confidence x visible length) wins, and the multi model
        wins ties. Scripts that confidently won other lines of the same image
        get a small bonus, so a Cyrillic word read as Latin look-alikes
        ("apeHpa" for "аренда") flips to the script the image is written in.
        """
        per_model = {model.name: self.recognize(crops, model) for model in models}

        def choose(index, favoured):
            best, alternatives = None, []
            for model in models:
                text, conf = per_model[model.name][index]
                text = text.strip()
                alternatives.append({"model": model.name, "text": text, "confidence": round(conf, 4)})
                if model.name != "multi" and (conf < 0.5 or script_share(text, model.script) < 0.3):
                    continue
                strength = reading_strength(text, conf)
                if model.name == "multi":
                    strength *= 1.05  # best general model; script models must clearly beat it
                elif model.name in favoured:
                    strength *= 1.15
                if (model.script in _LOOKALIKE_SCRIPTS and conf >= 0.6 and script_share(text, model.script) >= 0.6
                        and is_lookalike(text, per_model["multi"][index][0] if "multi" in per_model else "")):
                    strength *= 2.0  # the multi model only saw Latin look-alikes of these letters
                if best is None or strength > best[0]:
                    best = (strength, Reading(text, conf, model.name))
            reading = best[1] if best else Reading("", 0.0, models[0].name)
            reading.alternatives = alternatives
            return reading

        readings = [choose(i, set()) for i in range(len(crops))]
        favoured = {r.model for r in readings if r.model != "multi" and r.confidence >= 0.7}
        if favoured:
            readings = [choose(i, favoured) if r.model == "multi" else r for i, r in enumerate(readings)]
        return readings
