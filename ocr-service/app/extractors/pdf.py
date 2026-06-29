"""
PDF extraction: PyMuPDF text layer + pdfplumber tables, with a scanned-page
fallback to Tesseract OCR.

Per-page confidence:
  - page with a real text layer        -> 0.95 (digital PDF)
  - page that is blank (scanned image)  -> rendered to a pixmap and OCR'd,
                                           using Tesseract's own confidence
The document confidence is the mean of per-page confidences, so a mostly
scanned, poor-quality PDF lands below FinProof's 0.82 threshold naturally.
"""

from __future__ import annotations

import io

from . import image as image_extractor

# Below this many characters a page is treated as "no text layer" (scanned).
SCANNED_PAGE_CHAR_THRESHOLD = 20
TEXT_LAYER_CONFIDENCE = 0.95
# Render scale for OCR of scanned pages (2x ~= 144 dpi, good enough for OCR).
OCR_RENDER_SCALE = 2.0


def _tables_to_tsv(body: bytes, warnings: list[str]) -> tuple[str, bool]:
    """Extract tables with pdfplumber and serialize them as TSV blocks."""
    try:
        import pdfplumber
    except Exception as error:  # pragma: no cover - dependency guard
        warnings.append(f"pdfplumber unavailable: {error}")
        return "", False

    blocks: list[str] = []
    has_tables = False
    try:
        with pdfplumber.open(io.BytesIO(body)) as pdf:
            for page_index, page in enumerate(pdf.pages, start=1):
                for table in page.extract_tables() or []:
                    has_tables = True
                    rows = [
                        "\t".join((cell or "").strip() for cell in row)
                        for row in table
                        if row
                    ]
                    if rows:
                        blocks.append(f"[table p{page_index}]\n" + "\n".join(rows))
    except Exception as error:
        warnings.append(f"pdfplumber tables skipped: {error}")

    return ("\n\n".join(blocks), has_tables)


def extract(body: bytes) -> dict:
    warnings: list[str] = []

    try:
        import fitz  # PyMuPDF
    except Exception as error:  # pragma: no cover - dependency guard
        return {
            "text": "",
            "confidence": 0.0,
            "provider": "pymupdf",
            "pages": 0,
            "has_tables": False,
            "warnings": [f"pymupdf unavailable: {error}"],
        }

    try:
        doc = fitz.open(stream=body, filetype="pdf")
    except Exception as error:
        return {
            "text": "",
            "confidence": 0.0,
            "provider": "pymupdf",
            "pages": 0,
            "has_tables": False,
            "warnings": [f"pdf open failed: {error}"],
        }

    page_texts: list[str] = []
    page_confidences: list[float] = []
    used_ocr = False

    try:
        from PIL import Image

        for page in doc:
            layer_text = page.get_text("text").strip()
            if len(layer_text) >= SCANNED_PAGE_CHAR_THRESHOLD:
                page_texts.append(layer_text)
                page_confidences.append(TEXT_LAYER_CONFIDENCE)
                continue

            # Likely a scanned page -> render and OCR.
            try:
                pixmap = page.get_pixmap(matrix=fitz.Matrix(OCR_RENDER_SCALE, OCR_RENDER_SCALE))
                rendered = Image.open(io.BytesIO(pixmap.tobytes("png")))
                ocr_text, ocr_conf, ocr_warnings = image_extractor.ocr_image(rendered)
                warnings.extend(ocr_warnings)
                used_ocr = True
                page_texts.append(ocr_text)
                page_confidences.append(ocr_conf)
            except Exception as error:
                warnings.append(f"scanned page OCR failed: {error}")
                page_texts.append(layer_text)
                page_confidences.append(0.0)
    finally:
        pages = doc.page_count
        doc.close()

    table_text, has_tables = _tables_to_tsv(body, warnings)

    body_text = "\n\n".join(part for part in page_texts if part).strip()
    full_text = "\n\n".join(part for part in [body_text, table_text] if part).strip()

    if page_confidences:
        confidence = round(sum(page_confidences) / len(page_confidences), 4)
    else:
        confidence = 0.0

    if not full_text:
        confidence = 0.0
        warnings.append("no text extracted from pdf")

    provider = "pymupdf"
    if has_tables and not used_ocr:
        provider = "pdfplumber"
    elif used_ocr:
        provider = "tesseract"

    return {
        "text": full_text,
        "confidence": confidence,
        "provider": provider,
        "pages": pages,
        "has_tables": has_tables,
        "warnings": warnings,
    }
