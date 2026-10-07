"""Unit + integration tests for Task Pipe.

Run:  python -m unittest discover -s Cluster05-Task-Pipe/tests -v
The integration tests need RapidOCR's bundled models (no network).
"""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from taskpipe import enhance as enh  # noqa: E402
from taskpipe.geometry import (crop_quad, find_document_quad, rotate_bound, skew_angle,  # noqa: E402
                               transform_quads, vertical_fraction)
from taskpipe.imageio import ImageLoadError, load_image  # noqa: E402
from taskpipe.ocr import OcrEngine, OcrError, parse_langs, script_share  # noqa: E402
from taskpipe.pipeline import Line, order_lines  # noqa: E402

HAS_RAPIDOCR = importlib.util.find_spec("rapidocr") is not None


def text_card(text="TASK PIPE 2026", size=(220, 900), scale=2.4):
    image = np.full((*size, 3), 255, np.uint8)
    cv2.putText(image, text, (40, size[0] // 2 + 25), cv2.FONT_HERSHEY_SIMPLEX, scale, (20, 20, 20), 5, cv2.LINE_AA)
    return image


def quad(x0, y0, x1, y1):
    return np.float32([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])


class GeometryTests(unittest.TestCase):
    def test_right_angle_matrices_follow_pixels(self):
        image = np.zeros((40, 70, 3), np.uint8)
        image[5, 60] = 255  # marker at (x=60, y=5)
        for degrees in (90, 180, 270):
            rotated, matrix = rotate_bound(image, degrees)
            x, y = transform_quads(np.float32([[[60, 5]] * 4]), matrix)[0, 0]
            self.assertEqual(rotated[int(round(y)), int(round(x)), 0], 255, degrees)

    def test_crop_after_180_is_upright(self):
        # Regression: transformed corners must be re-ordered after a 180 turn,
        # so a crop follows the turned image. Without the re-order the crop
        # silently undoes the turn (upside-down text stays upside-down).
        image = text_card()
        box = quad(30, 60, 870, 170)
        before = cv2.cvtColor(crop_quad(image, box), cv2.COLOR_BGR2GRAY)
        turned, matrix = rotate_bound(image, 180)
        moved = transform_quads(box[None], matrix)[:, [2, 3, 0, 1]]
        after = cv2.cvtColor(crop_quad(turned, moved[0]), cv2.COLOR_BGR2GRAY)
        expected = cv2.rotate(before, cv2.ROTATE_180)
        self.assertEqual(expected.shape, after.shape)
        # (1 px resampling offsets remain on sharp glyph edges.)
        error_turned = np.abs(expected.astype(int) - after.astype(int)).mean()
        error_unturned = np.abs(before.astype(int) - after.astype(int)).mean()
        self.assertLess(error_turned, 0.25 * error_unturned)

    def test_skew_angle_sign(self):
        angle = np.radians(6.0)  # text rising to the right
        base = quad(0, 0, 400, 40) - [200, 20]
        rot = np.array([[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]], np.float32)
        tilted = (base @ rot.T) + [300, 300]
        self.assertAlmostEqual(skew_angle(tilted[None]), 6.0, delta=0.3)
        self.assertEqual(skew_angle(np.zeros((0, 4, 2), np.float32)), 0.0)

    def test_vertical_fraction(self):
        self.assertGreater(vertical_fraction(quad(0, 0, 30, 300)[None]), 0.9)
        self.assertEqual(vertical_fraction(quad(0, 0, 300, 30)[None]), 0.0)

    def test_document_quad_found_only_for_tilted_page(self):
        page = text_card(size=(300, 500))
        canvas = np.full((600, 800, 3), 70, np.uint8)
        src = np.float32([[0, 0], [500, 0], [500, 300], [0, 300]])
        dst = np.float32([[180, 120], [640, 90], [690, 470], [120, 430]])
        matrix = cv2.getPerspectiveTransform(src, dst)
        warped = cv2.warpPerspective(page, matrix, (800, 600), dst=canvas.copy(),
                                     borderMode=cv2.BORDER_TRANSPARENT)
        found = find_document_quad(warped)
        self.assertIsNotNone(found)
        self.assertLess(np.abs(found - dst).max(), 25)
        self.assertIsNone(find_document_quad(text_card()))  # page fills the frame


class EnhanceTests(unittest.TestCase):
    def test_analyze_flags_problems(self):
        clean = text_card()
        dark = (clean * 0.25).astype(np.uint8)
        low = (clean * 0.15 + 140).astype(np.uint8)
        noisy = np.clip(clean + np.random.default_rng(0).normal(0, 30, clean.shape), 0, 255).astype(np.uint8)
        self.assertLess(enh.analyze(dark)["brightness"], 70)
        self.assertLess(enh.analyze(low)["contrast"], 50)
        self.assertGreater(enh.analyze(noisy)["noise"], enh.analyze(clean)["noise"] + 5)

    def test_enhance_fixes_dark_image(self):
        dark = (text_card() * 0.25).astype(np.uint8)
        out, steps, _ = enh.enhance(dark)
        self.assertGreater(float(out.mean()), 150)
        self.assertTrue(any(s.startswith("gamma") or s.startswith("levels") for s in steps))

    def test_polarity(self):
        card = cv2.cvtColor(text_card(), cv2.COLOR_BGR2GRAY)
        self.assertTrue(enh.text_is_dark(card))
        self.assertFalse(enh.text_is_dark(255 - card))

    def test_line_variants_are_dark_on_light(self):
        inverted = 255 - text_card()
        for name, variant in enh.line_variants(inverted, inverted, deblur_kernel=enh.motion_psf(9, 10)).items():
            self.assertTrue(enh.text_is_dark(enh.to_gray(variant)), name)


class FakeEngine(OcrEngine):
    """Pretends to be the recognisers so model selection can be tested."""

    def __init__(self, outputs):
        super().__init__()
        self.outputs = outputs

    def recognize(self, crops, model):
        return [self.outputs[model.name][i] for i in range(len(crops))]


class OcrTests(unittest.TestCase):
    def test_parse_langs(self):
        self.assertEqual(parse_langs("en+HI"), ["en", "hi"])
        self.assertEqual(parse_langs(None), ["auto"])
        self.assertEqual(parse_langs(""), ["auto"])

    def test_models_for_langs(self):
        names = [m.name for m in OcrEngine.models_for_langs("hi")]
        self.assertEqual(names, ["devanagari", "multi"])
        self.assertIn("arabic", [m.name for m in OcrEngine.models_for_langs("auto")])
        with self.assertRaises(OcrError):
            OcrEngine.models_for_langs("xx")

    def test_script_share(self):
        self.assertEqual(script_share("नमस्ते", "devanagari"), 1.0)
        self.assertEqual(script_share("Hello", "devanagari"), 0.0)
        self.assertEqual(script_share("Привет", "cyrillic"), 1.0)

    def test_lookalike_cyrillic_beats_latin_homoglyphs(self):
        from taskpipe.ocr import is_lookalike
        self.assertTrue(is_lookalike("аренда", "apenna"))
        self.assertTrue(is_lookalike("Москву", "MocKBy"))
        self.assertFalse(is_lookalike("Москву", "Platform"))
        models = OcrEngine.models_for_langs("auto")
        engine = FakeEngine({
            "multi": [("Kparkoco4HaA", 0.81)],
            "devanagari": [("", 0.0)], "arabic": [("", 0.0)], "korean": [("", 0.0)],
            "cyrillic": [("Краткосрочная", 0.77)],
        })
        self.assertEqual(engine.best_model_per_line([None], models)[0].text, "Краткосрочная")

    def test_script_model_needs_its_script(self):
        models = OcrEngine.models_for_langs("auto")
        engine = FakeEngine({
            # line 0: Latin; every model reads it, multi must win.
            # line 1: Hindi; multi reads junk, devanagari must win.
            # line 2: Russian; multi returns blanks with high confidence.
            "multi": [("Platform 3", 0.99), ("HRA", 0.70), ("   ", 0.97)],
            "devanagari": [("Platform 3", 1.00), ("भारत एक देश", 0.95), ("Jo6pO", 0.82)],
            "arabic": [("Platform 3", 0.98), ("Hrd", 0.40), ("", 0.0)],
            "cyrillic": [("Platform 3", 0.99), ("", 0.0), ("Добро пожаловать", 0.99)],
            "korean": [("Platform3", 0.98), ("H", 0.48), ("o6po", 0.79)],
        })
        readings = engine.best_model_per_line([None, None, None], models)
        self.assertEqual([r.model for r in readings], ["multi", "devanagari", "cyrillic"])


class LayoutTests(unittest.TestCase):
    def test_rows_and_rtl(self):
        lines = [Line("second", 0.9, quad(10, 100, 200, 130).tolist(), "multi", ""),
                 Line("first-right", 0.9, quad(300, 10, 500, 40).tolist(), "multi", ""),
                 Line("first-left", 0.9, quad(10, 12, 200, 42).tolist(), "multi", ""),
                 Line("مرحبا", 0.9, quad(300, 200, 500, 230).tolist(), "arabic", ""),
                 Line("بكم", 0.9, quad(10, 200, 200, 230).tolist(), "arabic", "")]
        texts = [l.text for l in order_lines(lines)]
        self.assertEqual(texts, ["first-left", "first-right", "second", "مرحبا", "بكم"])


class ImageIoTests(unittest.TestCase):
    def test_formats(self):
        with tempfile.TemporaryDirectory() as tmp:
            rgba = Image.new("RGBA", (40, 20), (0, 0, 0, 0))
            rgba.save(Path(tmp) / "a.png")
            self.assertEqual(load_image(Path(tmp) / "a.png")[0, 0].tolist(), [255, 255, 255])
            Image.fromarray(np.full((20, 30), 4000, np.uint16)).save(Path(tmp) / "b.png")
            self.assertEqual(load_image(Path(tmp) / "b.png").shape, (20, 30, 3))
            exif = Image.new("RGB", (60, 20), (10, 200, 30))
            info = Image.Exif()
            info[0x0112] = 6  # rotate 90 on display
            exif.save(Path(tmp) / "c.jpg", exif=info)
            self.assertEqual(load_image(Path(tmp) / "c.jpg").shape[:2], (60, 20))
            (Path(tmp) / "bad.png").write_bytes(b"not an image")
            with self.assertRaises(ImageLoadError):
                load_image(Path(tmp) / "bad.png")


@unittest.skipUnless(HAS_RAPIDOCR, "rapidocr not installed")
class PipelineIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from taskpipe import TaskPipe
        cls.pipe = TaskPipe(langs="en")

    def read(self, image):
        return " ".join(self.pipe.process(image).text.split())

    def test_clean(self):
        self.assertEqual(self.read(text_card()), "TASK PIPE 2026")

    def test_upside_down_inverted_dark(self):
        image = cv2.rotate(255 - text_card(), cv2.ROTATE_180)
        image = (image * 0.35).astype(np.uint8)
        result = self.pipe.process(image)
        self.assertEqual(" ".join(result.text.split()), "TASK PIPE 2026")
        self.assertEqual(result.rotation, 180)

    def test_rotated_90(self):
        result = self.pipe.process(cv2.rotate(text_card(), cv2.ROTATE_90_CLOCKWISE))
        self.assertEqual(" ".join(result.text.split()), "TASK PIPE 2026")
        self.assertEqual(result.rotation, 270)

    def test_blank_image(self):
        result = self.pipe.process(np.full((300, 300, 3), 255, np.uint8))
        self.assertEqual(result.text, "")
        self.assertEqual(result.lines, [])


if __name__ == "__main__":
    unittest.main()
