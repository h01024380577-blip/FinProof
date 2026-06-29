"""
FastAPI app for the FinProof OCR / document-preprocessing microservice.

Routes:
  POST /extract  — multipart `file` (+ optional `content_type` form field) -> ExtractResponse
  GET  /health   — liveness probe for Docker / CI

Guards:
  - 20MB upload cap (413 -> TS caller falls back)
  - per-request extraction timeout (returns confidence=0.0, never hangs)
The service is designed to degrade to a low-confidence result rather than
fail, so the FinProof TS layer can always fall back to its legacy extractor.
"""

from __future__ import annotations

import asyncio
import os
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .extractor import extract_document
from .schema import ExtractResponse

MAX_UPLOAD_BYTES = int(os.environ.get("OCR_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))
EXTRACT_TIMEOUT_SECONDS = float(os.environ.get("OCR_EXTRACT_TIMEOUT_SECONDS", "60"))

app = FastAPI(title="FinProof OCR Service", version="0.1.0")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractResponse)
async def extract(
    file: UploadFile = File(...),
    content_type: Optional[str] = Form(default=None),
) -> ExtractResponse:
    body = await file.read()

    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"file exceeds {MAX_UPLOAD_BYTES} byte limit",
        )

    resolved_type = content_type or file.content_type or ""
    file_name = file.filename or "upload"

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(extract_document, file_name, resolved_type, body),
            timeout=EXTRACT_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        result = {
            "text": "",
            "confidence": 0.0,
            "provider": "timeout",
            "pages": 0,
            "has_tables": False,
            "warnings": [f"extraction timed out after {EXTRACT_TIMEOUT_SECONDS}s"],
        }

    return ExtractResponse(**result)
