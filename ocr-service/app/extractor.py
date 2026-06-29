"""
Extraction dispatcher — routes a document to the right extractor by
content-type / filename, and guarantees a well-formed, never-throwing result.

Any failure (unsupported type, parser crash) returns an empty-text,
confidence=0.0 response with a warning. The TS caller treats that as a miss
and falls back to its legacy extraction path (Strangler Fig).
"""

from __future__ import annotations

from .extractors import docx as docx_extractor
from .extractors import image as image_extractor
from .extractors import pdf as pdf_extractor

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".gif")


def _empty(provider: str, warning: str) -> dict:
    return {
        "text": "",
        "confidence": 0.0,
        "provider": provider,
        "pages": 0,
        "has_tables": False,
        "warnings": [warning],
    }


def detect_kind(file_name: str, content_type: str) -> str:
    name = (file_name or "").lower()
    ctype = (content_type or "").lower()

    if "pdf" in ctype or name.endswith(".pdf"):
        return "pdf"
    if "wordprocessingml.document" in ctype or name.endswith(".docx"):
        return "docx"
    if ctype.startswith("image/") or name.endswith(IMAGE_EXTENSIONS):
        return "image"
    return "unknown"


def extract_document(file_name: str, content_type: str, body: bytes) -> dict:
    if not body:
        return _empty("none", "empty file body")

    kind = detect_kind(file_name, content_type)

    try:
        if kind == "pdf":
            return pdf_extractor.extract(body)
        if kind == "docx":
            return docx_extractor.extract(body)
        if kind == "image":
            return image_extractor.extract(body)
        return _empty("none", f"unsupported document type for '{file_name}' ({content_type})")
    except Exception as error:  # last-resort guard: never surface a 500
        return _empty("error", f"extraction failed: {error}")
