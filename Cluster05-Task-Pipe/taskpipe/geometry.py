"""Geometry: line crops, rotation/deskew with box tracking, document dewarp.

Rotations return the 2x3 (or 3x3) matrix used so detected boxes can be
moved along with the image instead of re-running text detection.
"""

import cv2
import numpy as np


def order_quad(points):
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    pts = np.asarray(points, np.float32).reshape(4, 2)
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
                    np.float32)


def quad_size(quad):
    """(width, height) of a text quad along its own axes."""
    q = np.asarray(quad, np.float32).reshape(4, 2)
    width = max(np.linalg.norm(q[0] - q[1]), np.linalg.norm(q[3] - q[2]))
    height = max(np.linalg.norm(q[0] - q[3]), np.linalg.norm(q[1] - q[2]))
    return float(width), float(height)


def crop_quad(image, quad, pad_ratio=0.08):
    """Perspective-crop a text line, padded slightly so ascenders survive."""
    q = np.ascontiguousarray(np.asarray(quad, np.float32).reshape(4, 2))
    width, height = quad_size(q)
    width, height = max(2, int(round(width))), max(2, int(round(height)))
    pad = int(round(height * pad_ratio))
    dst = np.float32([[pad, pad], [pad + width, pad], [pad + width, pad + height], [pad, pad + height]])
    matrix = cv2.getPerspectiveTransform(q, dst)
    return cv2.warpPerspective(image, matrix, (width + 2 * pad, height + 2 * pad),
                               flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def transform_quads(quads, matrix):
    """Apply a 2x3 affine or 3x3 homography to (N, 4, 2) quads."""
    quads = np.asarray(quads, np.float32).reshape(-1, 4, 2)
    if len(quads) == 0:
        return quads
    matrix = np.asarray(matrix, np.float64)
    if matrix.shape == (2, 3):
        matrix = np.vstack([matrix, [0, 0, 1]])
    pts = cv2.perspectiveTransform(quads.reshape(-1, 1, 2).astype(np.float64), matrix)
    return pts.reshape(-1, 4, 2).astype(np.float32)


def rotate_bound(image, degrees, border=None):
    """Rotate counter-clockwise by `degrees`, expanding the canvas.

    Returns (rotated, 2x3 matrix). Right angles are exact (no interpolation).
    """
    h, w = image.shape[:2]
    k = int(round(degrees / 90.0)) % 4
    if abs(degrees - round(degrees / 90.0) * 90) < 1e-6:
        if k == 0:
            return image, np.float32([[1, 0, 0], [0, 1, 0]])
        rotated = np.ascontiguousarray(np.rot90(image, k))
        if k == 1:    # 90 CCW: (x, y) -> (y, w - 1 - x)
            matrix = [[0, 1, 0], [-1, 0, w - 1]]
        elif k == 2:  # 180
            matrix = [[-1, 0, w - 1], [0, -1, h - 1]]
        else:         # 270 CCW == 90 CW: (x, y) -> (h - 1 - y, x)
            matrix = [[0, -1, h - 1], [1, 0, 0]]
        return rotated, np.float32(matrix)
    matrix = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), degrees, 1.0)
    cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
    new_w, new_h = int(np.ceil(h * sin + w * cos)), int(np.ceil(h * cos + w * sin))
    matrix[0, 2] += new_w / 2.0 - w / 2.0
    matrix[1, 2] += new_h / 2.0 - h / 2.0
    if border is None:
        border = estimate_border_colour(image)
    rotated = cv2.warpAffine(image, matrix, (new_w, new_h), flags=cv2.INTER_CUBIC,
                             borderMode=cv2.BORDER_CONSTANT, borderValue=border)
    return rotated, matrix.astype(np.float32)


def estimate_border_colour(image):
    """Median colour of the outermost pixels (fill for rotated corners)."""
    strips = [image[0], image[-1], image[:, 0], image[:, -1]]
    values = np.concatenate([s.reshape(-1, image.shape[2] if image.ndim == 3 else 1) for s in strips])
    median = np.median(values, axis=0)
    return tuple(float(v) for v in np.atleast_1d(median))


def vertical_fraction(quads):
    """Area-weighted share of text quads that are taller than wide."""
    if len(quads) == 0:
        return 0.0
    tall = total = 0.0
    for quad in quads:
        width, height = quad_size(quad)
        area = width * height
        total += area
        # Single characters are square-ish; only clearly tall boxes vote.
        if height > 1.4 * width:
            tall += area
    return tall / total if total else 0.0


def skew_angle(quads):
    """Dominant text-line angle in degrees (positive = text rises to the right).

    Uses the top and bottom edges of each quad, weighted by length; returns 0
    when there are no reliable (wide) lines.
    """
    angles, weights = [], []
    for quad in np.asarray(quads, np.float32).reshape(-1, 4, 2):
        q = order_quad(quad)
        width, height = quad_size(q)
        if width < 2.0 * height:  # short words / single glyphs: unreliable
            continue
        for a, b in ((q[0], q[1]), (q[3], q[2])):
            dx, dy = float(b[0] - a[0]), float(b[1] - a[1])
            angles.append(-np.degrees(np.arctan2(dy, dx)))
            weights.append(np.hypot(dx, dy))
    if not angles:
        return 0.0
    order = np.argsort(angles)
    cumulative = np.cumsum(np.asarray(weights)[order])
    median = float(np.asarray(angles)[order][np.searchsorted(cumulative, cumulative[-1] / 2.0)])
    return median


def find_document_quad(image, min_area_ratio=0.2, max_area_ratio=0.97):
    """Find a page/card photographed at an angle: a large convex 4-gon.

    Returns an ordered quad or None. Conservative on purpose: the quad must
    be big, convex, clearly inside the frame and noticeably non-rectangular
    (an axis-aligned page needs no warp).
    """
    h, w = image.shape[:2]
    scale = 800.0 / max(h, w) if max(h, w) > 800 else 1.0
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale != 1.0 else image
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area_total = float(small.shape[0] * small.shape[1])
    best = None
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        hull = cv2.convexHull(contour)
        area = cv2.contourArea(hull)
        if not (min_area_ratio * area_total <= area <= max_area_ratio * area_total):
            continue
        approx = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        best = order_quad(approx.reshape(4, 2) / scale)
        break
    if best is None:
        return None
    # Corners touching the frame mean we probably found the image border.
    margin = 0.01 * max(h, w)
    touching = sum(1 for x, y in best if x < margin or y < margin or x > w - margin or y > h - margin)
    if touching >= 2:
        return None
    # Interior angles all ~90 and edges axis-aligned -> nothing to correct.
    def angle(a, b, c):
        v1, v2 = a - b, c - b
        cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9)
        return np.degrees(np.arccos(np.clip(cos, -1, 1)))
    corners = [angle(best[i - 1], best[i], best[(i + 1) % 4]) for i in range(4)]
    if all(abs(c - 90) < 3 for c in corners):
        return None
    return best


def warp_document(image, quad):
    """Warp the quad to a flat rectangle. Returns (image, 3x3 homography)."""
    q = order_quad(quad)
    width, height = quad_size(q)
    width, height = int(round(width)), int(round(height))
    dst = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    matrix = cv2.getPerspectiveTransform(q, dst)
    warped = cv2.warpPerspective(image, matrix, (width, height), flags=cv2.INTER_CUBIC,
                                 borderMode=cv2.BORDER_REPLICATE)
    return warped, matrix
