"""Photometric analysis and enhancement.

`analyze` measures what is wrong with an image; `enhance` fixes only those
problems (each step is recorded so the report explains what was done):

  impulse noise    -> median filter
  gaussian noise   -> non-local means denoise
  uneven lighting  -> background division (shadow removal)
  exposure         -> percentile contrast stretch + gamma to a target level
  low contrast     -> CLAHE on the lightness channel
  faded colour     -> saturation (chroma) boost
  blur             -> unsharp mask scaled to the measured blur

`line_variants` produces a few alternative renderings of one text-line crop
(original, enhanced, normalised grey, binarised, deblurred, polarity-fixed)
for the recogniser to choose from.
"""

import cv2
import numpy as np


def to_gray(image):
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image


def to_bgr(image):
    return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) if image.ndim == 2 else image


def noise_sigma(gray):
    """Immerkaer's fast noise estimate (std of additive Gaussian noise)."""
    kernel = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float32)
    h, w = gray.shape
    if h < 3 or w < 3:
        return 0.0
    response = np.abs(cv2.filter2D(gray.astype(np.float32), -1, kernel))
    # Ignore strong edges (text strokes) so they are not mistaken for noise.
    response = response[response < np.percentile(response, 90)]
    return float(np.sqrt(np.pi / 2.0) * response.mean() / 6.0) if response.size else 0.0


def impulse_ratio(gray):
    """Share of isolated pure-black/white pixels (salt-and-pepper)."""
    median = cv2.medianBlur(gray, 3)
    extreme = (gray <= 5) | (gray >= 250)
    isolated = np.abs(gray.astype(np.int16) - median.astype(np.int16)) > 80
    return float(np.mean(extreme & isolated))


def blur_score(gray):
    """Variance of the Laplacian, normalised by contrast (higher = sharper)."""
    contrast = float(np.percentile(gray, 98) - np.percentile(gray, 2)) or 1.0
    lap = cv2.Laplacian(gray, cv2.CV_32F)
    return float(lap.var()) / (contrast ** 2) * 1000.0


def illumination_unevenness(gray, dark_text=True):
    """Relative spread of the low-frequency background (0 = flat lighting).

    Text is removed first with a morphological close (dark ink) or open
    (light ink), so only the paper/sign lighting is measured.
    """
    h, w = gray.shape
    scale = 256.0 / max(h, w)
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else gray
    k = max(3, (min(small.shape) // 8) | 1)
    op = cv2.MORPH_CLOSE if dark_text else cv2.MORPH_OPEN
    background = cv2.medianBlur(cv2.morphologyEx(small, op, np.ones((k, k), np.uint8)), k)
    mean = float(background.mean()) or 1.0
    return float(np.percentile(background, 95) - np.percentile(background, 5)) / max(mean, 32.0)


def text_is_dark(gray):
    """Polarity guess for a whole image or crop: text is the minority class.

    Otsu splits pixels into two classes; the smaller class is the ink. Dark
    text on a light background returns True.
    """
    threshold, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bright_share = float(np.mean(binary > 0))
    return bright_share >= 0.5


def ink_contrast(gray):
    """Grey-level gap between the ink and background classes (Otsu split).

    Percentile ranges fail on pages where ink covers under 2% of pixels.
    """
    threshold, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    low, high = gray[gray <= threshold], gray[gray > threshold]
    if not low.size or not high.size:
        return 0.0
    return float(np.median(high) - np.median(low))


def analyze(image):
    """Measure the problems the enhancer may need to fix."""
    gray = to_gray(image)
    hsv = cv2.cvtColor(to_bgr(image), cv2.COLOR_BGR2HSV)
    dark_text = text_is_dark(gray)
    return {
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "brightness": round(float(gray.mean()), 1),
        "median": round(float(np.median(gray)), 1),
        "contrast": round(ink_contrast(gray), 1),
        "blur": round(blur_score(gray), 2),
        "noise": round(noise_sigma(gray), 2),
        "impulse": round(impulse_ratio(gray), 4),
        "unevenness": round(illumination_unevenness(gray, dark_text), 3),
        "saturation": round(float(hsv[..., 1].mean()), 1),
        "dark_text": bool(dark_text),
    }


def _gamma_lut(gamma):
    return np.clip(((np.arange(256) / 255.0) ** gamma) * 255.0 + 0.5, 0, 255).astype(np.uint8)


def flatten_illumination(lightness, dark_text):
    """Divide out the slowly varying background (shadows, vignetting)."""
    h, w = lightness.shape
    k = max(15, (min(h, w) // 12) | 1)
    k = min(k, 101)
    op = cv2.MORPH_CLOSE if dark_text else cv2.MORPH_OPEN
    background = cv2.morphologyEx(lightness, op, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    background = cv2.GaussianBlur(background, (0, 0), k / 3.0).astype(np.float32)
    light = lightness.astype(np.float32)
    # Gain is capped: a shadow at 30% is fully recovered, but a black night
    # sky is not amplified into grey sensor noise.
    max_gain = 3.0
    if dark_text:
        flat = light * np.minimum(235.0 / np.maximum(background, 1.0), max_gain)
    else:  # bright text on dark background: flatten the dark floor instead
        flat = 255.0 - (255.0 - light) * np.minimum(235.0 / np.maximum(255.0 - background, 1.0), max_gain)
    return np.clip(flat, 0, 255).astype(np.uint8)


def stretch_levels(lightness, low_pct=1.0, high_pct=99.0):
    """Map the [low, high] percentile range onto the full 0..255 range."""
    lo, hi = np.percentile(lightness, [low_pct, high_pct])
    if hi - lo < 8:
        return lightness, False
    scaled = (lightness.astype(np.float32) - lo) * (255.0 / (hi - lo))
    return np.clip(scaled, 0, 255).astype(np.uint8), True


def unsharp(image, sigma, amount):
    blurred = cv2.GaussianBlur(image, (0, 0), sigma)
    return cv2.addWeighted(image, 1.0 + amount, blurred, -amount, 0)


def enhance(image, metrics=None):
    """Return (enhanced BGR image, [step descriptions], metrics)."""
    metrics = metrics or analyze(image)
    out = to_bgr(image).copy()
    steps = []

    if metrics["impulse"] > 0.004:
        out = cv2.medianBlur(out, 3)
        steps.append(f"median_denoise (impulse noise {metrics['impulse']:.1%})")
    sigma = noise_sigma(to_gray(out))
    if sigma > 6.0:
        strength = float(np.clip(sigma * 0.9, 5, 18))
        out = cv2.fastNlMeansDenoisingColored(out, None, strength, strength, 7, 21)
        steps.append(f"nl_means_denoise (noise sigma {sigma:.1f}, h={strength:.0f})")

    lab = cv2.cvtColor(out, cv2.COLOR_BGR2LAB)
    lightness, chan_a, chan_b = cv2.split(lab)
    dark_text = metrics["dark_text"]

    if metrics["unevenness"] > 0.18:
        lightness = flatten_illumination(lightness, dark_text)
        steps.append(f"flatten_illumination (unevenness {metrics['unevenness']:.2f})")

    lightness, stretched = stretch_levels(lightness)
    if stretched and (metrics["contrast"] < 200 or metrics["brightness"] < 90 or metrics["brightness"] > 200):
        steps.append(f"levels_stretch (contrast {metrics['contrast']:.0f} -> full range)")
    # Exposure: push the background (majority) towards a comfortable level.
    background_level = float(np.median(lightness))
    target = 225.0 if dark_text else 40.0
    if 5 < background_level < 250 and abs(background_level - target) > 25:
        gamma = float(np.clip(np.log(target / 255.0) / np.log(background_level / 255.0), 0.35, 2.5))
        lightness = cv2.LUT(lightness, _gamma_lut(gamma))
        steps.append(f"gamma {gamma:.2f} (background {background_level:.0f} -> {target:.0f})")

    if metrics["contrast"] < 120 or metrics["unevenness"] > 0.18:
        tile = 8
        lightness = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(tile, tile)).apply(lightness)
        steps.append("clahe (local contrast)")

    # Saturation: restore faded colour (cosmetic; OCR reads lightness).
    # Smoothed so colour noise does not count as colour.
    smooth_a = cv2.GaussianBlur(chan_a, (0, 0), 3).astype(np.float32) - 128
    smooth_b = cv2.GaussianBlur(chan_b, (0, 0), 3).astype(np.float32) - 128
    chroma = np.hypot(smooth_a, smooth_b)
    if metrics["saturation"] < 60 and float(chroma.mean()) > 4.0:
        boost = 1.5
        chan_a = np.clip((chan_a.astype(np.float32) - 128) * boost + 128, 0, 255).astype(np.uint8)
        chan_b = np.clip((chan_b.astype(np.float32) - 128) * boost + 128, 0, 255).astype(np.uint8)
        steps.append(f"saturation x{boost}")
    out = cv2.cvtColor(cv2.merge((lightness, chan_a, chan_b)), cv2.COLOR_LAB2BGR)

    if metrics["blur"] < 25:
        amount = float(np.clip(1.6 - metrics["blur"] / 25.0, 0.6, 1.6))
        out = unsharp(out, 1.4, amount)
        steps.append(f"unsharp_mask x{amount:.1f} (blur score {metrics['blur']:.1f})")
    return out, steps, metrics


def normalise_polarity(image, dark_text=None):
    """Make text dark on a light background (what OCR models expect most)."""
    gray = to_gray(image)
    if dark_text is None:
        dark_text = text_is_dark(gray)
    return (image if dark_text else cv2.bitwise_not(image)), (not dark_text)


def gaussian_psf(sigma):
    size = max(3, int(round(sigma * 6)) | 1)
    kernel = cv2.getGaussianKernel(size, sigma)
    return (kernel @ kernel.T).astype(np.float32)


def motion_psf(length, angle):
    """Straight-line motion blur of `length` px at `angle` degrees (CCW)."""
    length = max(3, int(round(length)) | 1)
    kernel = np.zeros((length, length), np.float32)
    kernel[length // 2, :] = 1.0
    matrix = cv2.getRotationMatrix2D((length / 2.0 - 0.5, length / 2.0 - 0.5), angle, 1.0)
    kernel = cv2.warpAffine(kernel, matrix, (length, length))
    return kernel / max(float(kernel.sum()), 1e-6)


def deblur_candidates(line_height):
    """Coarse PSF grid for a blurry image, scaled to the text-line height.

    Returns [(label, params)] with params ("gauss", sigma) or
    ("motion", length, angle); see `psf_from_params` / `refine_params`.
    """
    candidates = [(f"gauss{s:.1f}", ("gauss", s)) for s in (line_height / 40.0, line_height / 25.0) if s >= 0.8]
    for fraction in (0.12, 0.18, 0.24, 0.3):
        length = int(round(line_height * fraction)) | 1
        if length < 5:
            continue
        for angle in (0, 15, -15, 30, -30, 90):
            candidates.append((f"motion{length}@{angle}", ("motion", length, angle)))
    return candidates


def refine_params(params):
    """Neighbouring PSFs around a coarse winner (length +-2 px, angle +-7)."""
    if params[0] != "motion":
        return []
    _, length, angle = params
    return [(f"motion{l}@{a}", ("motion", l, a))
            for l in (length - 2, length, length + 2) for a in (angle - 7, angle, angle + 7)
            if l >= 3 and (l, a) != (length, angle)]


def psf_from_params(params):
    return gaussian_psf(params[1]) if params[0] == "gauss" else motion_psf(params[1], params[2])


DEBLUR_HEIGHT = 64  # deblur at (about) the recogniser's own input scale


def to_deblur_scale(gray):
    """Shrink tall line crops: the recogniser sees ~48 px lines anyway, and
    deconvolving 200 px lines with 45 px kernels is very slow."""
    if gray.shape[0] <= DEBLUR_HEIGHT:
        return gray
    factor = DEBLUR_HEIGHT / gray.shape[0]
    return cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)


def deconvolve(gray, kernel, iterations=10):
    """Richardson-Lucy deconvolution (undoes blur with a known PSF)."""
    image = gray.astype(np.float32) / 255.0 + 1e-3
    estimate = image.copy()
    mirrored = np.ascontiguousarray(kernel[::-1, ::-1])
    for _ in range(iterations):
        blurred = cv2.filter2D(estimate, -1, kernel, borderType=cv2.BORDER_REPLICATE) + 1e-6
        estimate *= cv2.filter2D(image / blurred, -1, mirrored, borderType=cv2.BORDER_REPLICATE)
    return np.clip(estimate * 255.0, 0, 255).astype(np.uint8)


def line_variants(original_crop, enhanced_crop, deblur_kernel=None):
    """Alternative renderings of one text-line crop, simplest first.

    Every variant has dark text on a light background (per-crop polarity),
    which fixes inverted signs even when only part of the image is inverted.
    `deblur_kernel` (chosen per image by the pipeline) adds a deconvolved one.
    """
    variants = {}
    dark_text = text_is_dark(to_gray(enhanced_crop))
    original, _ = normalise_polarity(original_crop, dark_text)
    enhanced, _ = normalise_polarity(enhanced_crop, dark_text)
    variants["original"] = to_bgr(original)
    variants["enhanced"] = to_bgr(enhanced)
    gray = to_gray(enhanced)
    stretched, _ = stretch_levels(gray, 2, 98)
    variants["gray_stretch"] = to_bgr(stretched)
    _, otsu = cv2.threshold(cv2.GaussianBlur(stretched, (3, 3), 0), 0, 255,
                            cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants["binary"] = to_bgr(otsu)
    if deblur_kernel is not None:
        # Deconvolve the unclipped signal (blur is linear), stretch afterwards.
        sharp = deconvolve(to_deblur_scale(to_gray(original)), deblur_kernel)
        variants["deblur"] = to_bgr(stretch_levels(sharp, 2, 98)[0])
    return variants
