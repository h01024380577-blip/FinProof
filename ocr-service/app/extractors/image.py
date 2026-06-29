"""
Image / scanned-page OCR via Tesseract (pytesseract).

Confidence is derived from Tesseract's own per-word confidence
(`image_to_data` -> conf), averaged and scaled to 0~1. A poor scan
naturally produces a low average, so the result lands below FinProof's
0.82 low-confidence threshold without any artificial flooring.
"""

from __future__ import annotations

import io

from PIL import Image

DEFAULT_LANG = "kor+eng"


def _avg_confidence(data: dict) -> float:
    """Average Tesseract word confidences (ignoring -1 / non-word boxes) to 0~1."""
    raw = data.get("conf", [])
    scores: list[float] = []
    for value in raw:
        try:
            conf = float(value)
        except (TypeError, ValueError):
            continue
        if conf >= 0:
            scores.append(conf)
    if not scores:
        return 0.0
    return round((sum(scores) / len(scores)) / 100.0, 4)


def ocr_image(image: "Image.Image", lang: str = DEFAULT_LANG) -> tuple[str, float, list[str]]:
    """OCR a PIL image -> (text, confidence 0~1, warnings)."""
    import pytesseract  # imported lazily so the module loads without the binary present

    warnings: list[str] = []
    try:
        data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)
    except pytesseract.TesseractError as error:
        return "", 0.0, [f"tesseract error: {error}"]
    except Exception as error:  # missing language pack, binary not found, etc.
        return "", 0.0, [f"tesseract unavailable: {error}"]

    words = [w for w in data.get("text", []) if isinstance(w, str) and w.strip()]
    text = " ".join(words).strip()
    confidence = _avg_confidence(data) if text else 0.0
    if not text:
        warnings.append("no text recognized by tesseract")
    return text, confidence, warnings


def extract(body: bytes, lang: str = DEFAULT_LANG) -> dict:
    """Entry point for the /extract image path."""
    try:
        image = Image.open(io.BytesIO(body))
        image.load()
    except Exception as error:
        return {
            "text": "",
            "confidence": 0.0,
            "provider": "tesseract",
            "pages": 0,
            "has_tables": False,
            "warnings": [f"image open failed: {error}"],
        }

    text, confidence, warnings = ocr_image(image, lang=lang)
    return {
        "text": text,
        "confidence": confidence,
        "provider": "tesseract",
        "pages": 1,
        "has_tables": False,
        "warnings": warnings,
    }
