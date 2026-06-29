"""
Request / response contracts for the OCR microservice.

`ExtractResponse` is intentionally aligned with FinProof's TypeScript
`ExtractedDocument` (src/server/analysis/review-analysis-pipeline.ts):

  - `confidence` is on the SAME 0~1 scale. FinProof treats `confidence < 0.82`
    as low-confidence OCR (review-subagents.ts:hasLowOcrConfidence,
    model-router.ts:ocr_visual_understanding). Poor scans must therefore
    naturally fall below 0.82.
  - `provider` mirrors the engine that actually produced the text.

The service NEVER raises 500 on a bad document; it returns a low-confidence
(`confidence=0.0`) result with a warning so the TS caller can fall back.
"""

from __future__ import annotations

from pydantic import BaseModel


class ExtractResponse(BaseModel):
    text: str
    confidence: float          # 0~1, same scale as ExtractedDocument.confidence
    provider: str              # "pymupdf" | "pdfplumber" | "tesseract" | "python-docx"
    pages: int = 0
    has_tables: bool = False
    warnings: list[str] = []
