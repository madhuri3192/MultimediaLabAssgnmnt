"""Build the Task Pipe benchmark: clean multilingual text cards + degraded copies.

Clean cards are rendered by a headless Chromium browser (Edge or Chrome) so
complex scripts (Devanagari conjuncts, Arabic joining) are shaped correctly;
Pillow without libraqm cannot do that. Each card is then degraded with a
seeded set of distortions (blur, exposure, noise, inversion, rotation, ...).

Output layout (default: datasets/task-pipe):
  clean/<card>.png             browser-rendered originals
  degraded/<card>__<kind>.png  benchmark inputs
  ground_truth.json            {image: {"text": ..., "lang": ..., "degradation": ...}}

Usage:
  python Cluster05-Task-Pipe/tools/make_benchmark.py
  python Cluster05-Task-Pipe/tools/make_benchmark.py --out datasets/task-pipe --browser "C:/.../msedge.exe"
"""

import argparse
import html
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

# name, lang, lines, font stack, font size px, foreground, background
CARDS = [
    ("en_invoice", "en", ["Invoice No. 4821 - Due 12 March 2026",
                          "Total amount payable: $1,249.50",
                          "Please keep this receipt for your records."],
     "Arial", 40, "#1a1a1a", "#ffffff"),
    ("en_sign", "en", ["EMERGENCY EXIT", "Keep this door closed"],
     "Arial Black, Arial", 64, "#ffffff", "#1f7a3a"),
    ("en_serif", "en", ["The quick brown fox jumps", "over the lazy dog near 221B Baker Street."],
     "Georgia", 40, "#222222", "#f4ecd8"),
    ("es_text", "es", ["El rápido zorro marrón salta", "sobre el perro perezoso. Año 2026"],
     "Calibri", 46, "#111111", "#ffffff"),
    ("fr_text", "fr", ["Bienvenue à la bibliothèque", "Ouvert du lundi au vendredi"],
     "Georgia", 44, "#102040", "#e8f0ff"),
    ("de_text", "de", ["Größe und Gewicht prüfen", "Hauptstraße 15, München"],
     "Arial", 46, "#000000", "#fff6c0"),
    ("hi_text", "hi", ["भारत एक विशाल देश है", "आज का तापमान 32 डिग्री है", "कृपया शांति बनाए रखें"],
     "Nirmala UI", 46, "#111111", "#ffffff"),
    ("ru_text", "ru", ["Добро пожаловать в Москву", "Цена билета: 450 рублей"],
     "Times New Roman", 50, "#111111", "#ffffff"),
    ("ar_text", "ar", ["مرحبا بكم في المكتبة", "ساعات العمل من التاسعة صباحا"],
     "Arial", 52, "#111111", "#ffffff"),
    ("zh_text", "zh", ["欢迎来到图书馆", "营业时间上午九点至下午六点"],
     "Microsoft YaHei", 48, "#111111", "#ffffff"),
    ("ja_text", "ja", ["東京駅はこちらです", "ご利用ありがとうございます"],
     "Yu Gothic", 48, "#111111", "#ffffff"),
    ("ko_text", "ko", ["서울 지하철 2호선", "안녕하세요 반갑습니다"],
     "Malgun Gothic", 50, "#111111", "#ffffff"),
    ("mixed_en_hi", "en,hi", ["Platform No. 3", "प्लेटफॉर्म नंबर 3", "Next train 10:45"],
     "Nirmala UI, Arial", 46, "#ffffff", "#1d3f8f"),
]

# Degradations applied to every card in FULL_SET_LANGS; others get a subset.
ALL_KINDS = ["clean", "gauss_blur", "motion_blur", "dark", "overexposed", "low_contrast",
             "noise", "jpeg", "inverted", "rot90", "rot180", "rot270", "skew", "perspective",
             "shadow", "low_res", "faded_color", "combo"]
SUBSET_KINDS = ["clean", "gauss_blur", "dark", "low_contrast", "inverted", "rot180",
                "skew", "shadow", "combo"]
FULL_SET_CARDS = {"en_invoice", "en_sign", "hi_text", "zh_text", "ru_text", "mixed_en_hi"}

BROWSER_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_browser(explicit=None):
    for candidate in ([explicit] if explicit else []) + BROWSER_CANDIDATES:
        if candidate and Path(candidate).is_file():
            return candidate
    for name in ("msedge", "google-chrome", "chromium", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    raise SystemExit("No Chromium browser found; pass --browser PATH.")


def card_html(lines, font, size, fg, bg, rtl):
    body = "".join(f"<div>{html.escape(line)}</div>" for line in lines)
    direction = "rtl" if rtl else "ltr"
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
html, body {{ margin: 0; background: {bg}; }}
.card {{ box-sizing: border-box; width: 1000px; min-height: 420px; padding: 48px 56px;
  display: flex; flex-direction: column; justify-content: center; gap: 18px;
  font-family: {font}, sans-serif; font-size: {size}px; color: {fg}; direction: {direction};
  line-height: 1.25; }}
</style></head><body><div class="card">{body}</div></body></html>"""


def render_cards(browser, clean_dir):
    clean_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, lang, lines, font, size, fg, bg in CARDS:
            page = Path(tmp) / f"{name}.html"
            page.write_text(card_html(lines, font, size, fg, bg, lang == "ar"), encoding="utf-8")
            target = clean_dir / f"{name}.png"
            subprocess.run([browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                            "--force-device-scale-factor=1", "--window-size=1000,420",
                            f"--user-data-dir={Path(tmp) / 'profile'}",
                            f"--screenshot={target}", page.as_uri()],
                           check=True, capture_output=True, timeout=60)
            if not target.is_file():
                raise SystemExit(f"Browser did not write {target}")
            print(f"rendered {target.name}")


# ---------------------------------------------------------------- degradations

def _noise(img, rng, sigma):
    return np.clip(img.astype(np.float32) + rng.normal(0, sigma, img.shape), 0, 255).astype(np.uint8)


def _gamma(img, gamma, gain=1.0):
    table = np.clip(((np.arange(256) / 255.0) ** gamma) * 255 * gain, 0, 255).astype(np.uint8)
    return cv2.LUT(img, table)


def _motion_blur(img, length, angle):
    kernel = np.zeros((length, length), np.float32)
    kernel[length // 2, :] = 1.0
    rot = cv2.getRotationMatrix2D((length / 2 - 0.5, length / 2 - 0.5), angle, 1.0)
    kernel = cv2.warpAffine(kernel, rot, (length, length))
    return cv2.filter2D(img, -1, kernel / kernel.sum())


def _rotate_free(img, degrees, border):
    h, w = img.shape[:2]
    rot = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    cos, sin = abs(rot[0, 0]), abs(rot[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    rot[0, 2] += nw / 2 - w / 2
    rot[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(img, rot, (nw, nh), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=border)


def _perspective(img, rng):
    h, w = img.shape[:2]
    pad = 80
    canvas = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(90, 95, 100))
    H, W = canvas.shape[:2]
    src = np.float32([[pad, pad], [pad + w, pad], [pad + w, pad + h], [pad, pad + h]])
    j = lambda s: rng.uniform(-s, s)
    dst = np.float32([[pad + 60 + j(10), pad + 30 + j(10)], [pad + w - 20 + j(10), pad - 25 + j(10)],
                      [pad + w + 10 + j(10), pad + h + 20 + j(10)], [pad - 10 + j(10), pad + h - 35 + j(10)]])
    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(canvas, matrix, (W, H), borderMode=cv2.BORDER_CONSTANT,
                               borderValue=(90, 95, 100))


def _shadow(img):
    h, w = img.shape[:2]
    xs = np.linspace(0, 1, w)[None, :]
    ys = np.linspace(0, 1, h)[:, None]
    # Diagonal fall-off plus a soft dark blob, like a hand/phone shadow.
    mask = 0.35 + 0.65 * np.clip(1.2 - (xs * 0.8 + ys * 0.6), 0, 1)
    blob = np.exp(-(((xs - 0.75) ** 2) / 0.02 + ((ys - 0.7) ** 2) / 0.05))
    mask = np.clip(mask - 0.3 * blob, 0.15, 1.0)
    return np.clip(img.astype(np.float32) * mask[..., None], 0, 255).astype(np.uint8)


def degrade(img, kind, rng):
    border = tuple(int(v) for v in np.median(img.reshape(-1, 3), axis=0))
    if kind == "clean":
        return img
    if kind == "gauss_blur":
        return cv2.GaussianBlur(img, (0, 0), 2.6)
    if kind == "motion_blur":
        return _motion_blur(img, 13, 12)
    if kind == "dark":
        return _noise(_gamma(img, 1.8, 0.28), rng, 3)
    if kind == "overexposed":
        return _gamma(img, 0.35, 1.25)
    if kind == "low_contrast":
        return (img.astype(np.float32) * 0.18 + 150).astype(np.uint8)
    if kind == "noise":
        noisy = _noise(img, rng, 38)
        salt = rng.random(img.shape[:2])
        noisy[salt < 0.02] = 0
        noisy[salt > 0.98] = 255
        return noisy
    if kind == "jpeg":
        small = cv2.resize(img, None, fx=0.6, fy=0.6, interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 7])
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if kind == "inverted":
        return cv2.bitwise_not(img)
    if kind == "rot90":
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    if kind == "rot180":
        return cv2.rotate(img, cv2.ROTATE_180)
    if kind == "rot270":
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if kind == "skew":
        return _rotate_free(img, 9.0, border)
    if kind == "perspective":
        return _perspective(img, rng)
    if kind == "shadow":
        return _shadow(img)
    if kind == "low_res":
        return cv2.resize(img, None, fx=0.28, fy=0.28, interpolation=cv2.INTER_AREA)
    if kind == "faded_color":
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[..., 1] *= 0.25
        faded = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)
        tint = np.array([40, 90, 140], np.float32)  # warm/yellowed paper cast (BGR)
        return np.clip(faded * 0.55 + tint * 0.45 + 30, 0, 255).astype(np.uint8)
    if kind == "combo":
        # Upside-down, under-exposed, blurred, noisy, JPEG phone snapshot.
        out = cv2.rotate(img, cv2.ROTATE_180)
        out = _gamma(out, 1.6, 0.45)
        out = cv2.GaussianBlur(out, (0, 0), 1.6)
        out = _noise(out, rng, 9)
        ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 35])
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    raise ValueError(kind)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "datasets" / "task-pipe"))
    parser.add_argument("--browser", default=None)
    parser.add_argument("--skip-render", action="store_true", help="Reuse existing clean/ cards")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args(argv)

    out = Path(args.out).resolve()
    clean_dir, degraded_dir = out / "clean", out / "degraded"
    if not args.skip_render:
        render_cards(find_browser(args.browser), clean_dir)
    degraded_dir.mkdir(parents=True, exist_ok=True)

    truth = {}
    for index, (name, lang, lines, *_rest) in enumerate(CARDS):
        img = cv2.imread(str(clean_dir / f"{name}.png"), cv2.IMREAD_COLOR)
        if img is None:
            raise SystemExit(f"Missing clean card {name}.png (run without --skip-render)")
        kinds = ALL_KINDS if name in FULL_SET_CARDS else SUBSET_KINDS
        for kind in kinds:
            rng = np.random.default_rng(args.seed * 1000 + index * 37 + ALL_KINDS.index(kind))
            file_name = f"{name}__{kind}.png"
            cv2.imwrite(str(degraded_dir / file_name), degrade(img, kind, rng))
            truth[f"degraded/{file_name}"] = {"text": "\n".join(lines), "lang": lang,
                                             "degradation": kind, "card": name}
    (out / "ground_truth.json").write_text(json.dumps(truth, indent=2, ensure_ascii=False) + "\n",
                                           encoding="utf-8")
    print(f"wrote {len(truth)} benchmark images to {degraded_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
