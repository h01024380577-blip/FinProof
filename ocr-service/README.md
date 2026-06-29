# FinProof OCR / 문서 전처리 마이크로서비스

PDF·이미지·표가 많은 금융 광고물의 **문서 추출 품질**을 올리기 위한 Python(FastAPI)
마이크로서비스. FinProof 본체의 약한 TS 로컬 추출을 **삭제하지 않고 앞단에서 보완**하며,
서비스가 꺼져 있거나 실패하면 기존 TS 추출로 자동 폴백한다 (Strangler Fig).

> **적용 범위**: 두 추출 지점 모두 이 서비스로 라우팅된다(둘 다 OFF가 기본, 실패 시 폴백).
> - **Phase 1** — 지식 문서 인제스천(`extractKnowledgeDocumentText`).
> - **Phase 2** — 심사 파일 OCR(`review-analysis-pipeline.ts`의 `createPythonServiceOcrProvider`).
>   디지털 텍스트/PDF는 기존 로컬 추출을 그대로 쓰고, **이미지·스캔 PDF**(기존엔 metadata-only
>   placeholder로 빠지던 파일)만 서비스로 보낸다. 실패 시 `sampleOrMetadataDocument`로 폴백.

---

## 왜 별도 Python 서비스인가

| | 기존 TS 추출 | 이 서비스 |
|---|---|---|
| PDF | `pdftotext -layout` (텍스트 레이어만) | PyMuPDF 텍스트 + **스캔 페이지 Tesseract 폴백** |
| 표 | 소실 | pdfplumber로 TSV 보존 (`has_tables=true`) |
| DOCX | JSZip + 정규식 (표 구조 소실) | python-docx로 **표 셀까지 보존** |
| 이미지/스캔 | OCR 없음(placeholder 문자열) | Tesseract `kor+eng` OCR |
| confidence | 없음 | 0~1, 스캔 품질 반영 |

---

## 응답 계약 (`ExtractResponse`)

TS의 `ExtractedDocument`(`src/server/analysis/review-analysis-pipeline.ts`)와 **정합**한다.

```jsonc
{
  "text": "추출 본문 (+ 표 TSV)",
  "confidence": 0.95,        // 0~1, ExtractedDocument.confidence와 동일 스케일
  "provider": "pymupdf",     // pymupdf | pdfplumber | tesseract | python-docx
  "pages": 3,
  "has_tables": true,
  "warnings": []
}
```

### confidence 산정 규칙 (0.82 임계 호환)

FinProof는 `confidence < 0.82`를 **저신뢰 OCR**로 본다
(`review-subagents.ts:hasLowOcrConfidence`, `model-router.ts:ocr_visual_understanding`).
이 서비스의 confidence도 동일 스케일이며, 스캔 품질이 낮으면 **자연히 0.82 미만**이 나온다.

| 입력 | confidence | provider |
|---|---|---|
| 텍스트 레이어 PDF 페이지 | 0.95 | `pymupdf` (표 감지 시 `pdfplumber`) |
| 스캔 PDF 페이지 / 이미지 | Tesseract 단어별 conf 평균 ÷ 100 (0~1) | `tesseract` |
| DOCX | 0.97 | `python-docx` |
| 추출 실패 / 손상 / 미지원 | **0.0** + warning (500 아님) | `none` / `error` / `timeout` |

> 서비스는 **절대 500으로 죽지 않는다.** 어떤 실패든 `confidence=0.0` 저신뢰 결과로 응답해
> TS 폴백이 받도록 한다.

---

## 엔드포인트

- `POST /extract` — multipart `file`(필수) + optional `content_type` 폼필드 → `ExtractResponse`
- `GET /health` — `{"status":"ok"}` (Docker HEALTHCHECK / CI)

가드: 업로드 20MB 상한(초과 시 413), 추출 타임아웃(기본 60s, 초과 시 `confidence=0.0`).
환경변수 `OCR_MAX_UPLOAD_BYTES`, `OCR_EXTRACT_TIMEOUT_SECONDS`로 조정.

---

## 실행

### Docker (권장 — Tesseract 포함)

```bash
cd ocr-service
docker build -t finproof-ocr .
docker run --rm -p 8000:8000 finproof-ocr
curl -s localhost:8000/health      # {"status":"ok"}
```

### 로컬 venv (Apple Silicon — 시스템 파이썬 미오염)

```bash
cd ocr-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# 이미지/스캔 OCR을 쓰려면 Tesseract 바이너리 필요:
#   brew install tesseract tesseract-lang
uvicorn app.main:app --port 8000
# 다른 셸에서:
curl -s localhost:8000/health
deactivate
```

### 테스트

```bash
source .venv/bin/activate
pip install -r requirements.txt pytest httpx
pytest -q          # Tesseract 미설치 시 이미지 OCR 케이스는 자동 skip
deactivate
```

> 코드 자체는 Python 3.9~3.11 호환(런타임 평가 타입은 `Optional[str]` 사용). 배포 이미지는 3.11.

---

## FinProof 본체 접합 (TS)

`src/server/knowledge/ocr-service-client.ts` 가 `rerank-provider.ts`의
"외부 프로바이더 + 폴백" 패턴을 그대로 따른다. `extractKnowledgeDocumentText` 맨 앞에
try 블록 하나만 추가됐고, 기존 분기(docx/pdf/text/placeholder)는 전부 폴백으로 보존된다.

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `FINPROOF_OCR_PROVIDER` | (미설정) | `python_service`일 때만 ON. **미설정이면 기존 동작 100% 동일** |
| `FINPROOF_OCR_ENDPOINT` | — | 서비스 베이스 URL (예: `http://localhost:8000`) |
| `FINPROOF_OCR_TIMEOUT_MS` | `30000` | 호출 타임아웃 |

```bash
FINPROOF_OCR_PROVIDER=python_service \
FINPROOF_OCR_ENDPOINT=http://localhost:8000 \
npm run dev
```

> **호환성 메모**: `python_service`는 `provider-config.ts`에는 여전히 미지의 값이다. 분석
> 파이프라인은 `defaultOcrProvider`에서 이 env 값을 **직접** 보고 Python 서비스 프로바이더로
> 분기하므로(provider-config는 무수정), 켜면 **지식 인제스천(Phase 1)과 심사 파일 OCR(Phase 2)
> 둘 다** 서비스를 탄다. 미설정이면 양쪽 모두 기존 동작 그대로다.

---

## Part C — eval before/after 측정

문서 추출이 좋아지면 RAG 검색 품질이 좋아지므로, `finproof-eval` 하니스의
`context_precision` / `context_recall`에서 효과가 드러난다.

### 측정 절차

1. **Before**: `FINPROOF_OCR_PROVIDER` 미설정(서비스 OFF) 상태로, 스캔/표 포함 실제 광고
   패키지를 지식 코퍼스로 인제스천 → 리뷰 실행 → 결과를 `pairs.jsonl`로 export →
   `python -m harness.runner --pairs datasets/pairs.jsonl`.
2. **서비스 기동**: `docker run -p 8000:8000 finproof-ocr` → `/health` 200 확인.
3. **After**: `FINPROOF_OCR_PROVIDER=python_service`, `FINPROOF_OCR_ENDPOINT=http://localhost:8000`
   설정 후 **동일 코퍼스 재인제스천 + 동일 리뷰** 재실행 → export → 동일 하니스 재채점.
4. 아래 표에 점수를 기록.

### 결과 표

| 지표 | Before (OCR OFF) | After (python_service) | Δ |
|---|---|---|---|
| context_precision | _TBD_ | _TBD_ | _TBD_ |
| context_recall | _TBD_ | _TBD_ | _TBD_ |
| issue_detection F1 | _TBD_ | _TBD_ | _TBD_ |
| risk under_classified_rate | _TBD_ | _TBD_ | _TBD_ |

> ⚠️ **아직 측정 전.** 진짜 before/after는 **실제 스캔/표 문서 코퍼스 + 구동 중인
> Postgres/분석 스택**을 거쳐 `pairs.jsonl`을 만들어야 한다. 리포지토리의
> `finproof-eval/datasets/pairs.example.jsonl`(더미 3건)은 OCR 인제스천 경로를 자극하지
> 않으므로 이 비교에 쓸 수 없다 — 숫자를 지어내지 않고 절차만 확정해 둔다.
>
> 참고: 하니스 자체는 정상 동작한다(예시 데이터 기준 baseline 스코어카드 확인됨). 실제
> 코퍼스가 준비되면 위 표를 채운다.

---

## 다음 단계 (이번 PR 범위 밖)

1. **한국어 도메인 OCR** — PaddleOCR / 파인튜닝 도입은 baseline 효과가 eval로 확인된 뒤.
   (현재 Tesseract OCR은 읽기순서·전처리 측면에서 개선 여지가 있음)
2. **배포** — EC2/별도 호스팅은 PoC 효과 증명 후.
