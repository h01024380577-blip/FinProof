# FinProof OCR / 문서 전처리 마이크로서비스

PDF·이미지·표가 많은 금융 광고물의 **문서 추출 품질**을 올리기 위한 Python(FastAPI)
마이크로서비스. FinProof 본체의 약한 TS 로컬 추출을 **삭제하지 않고 앞단에서 보완**하며,
서비스가 꺼져 있거나 실패하면 기존 TS 추출로 자동 폴백한다 (Strangler Fig).

> **적용 범위**: 두 추출 지점 모두 이 서비스로 라우팅된다(둘 다 OFF가 기본, 실패 시 폴백).
>
> - **Phase 1** — 지식 문서 인제스천(`extractKnowledgeDocumentText`).
> - **Phase 2** — 심사 파일 OCR(`review-analysis-pipeline.ts`의 `createPythonServiceOcrProvider`).
>   디지털 텍스트/PDF는 기존 로컬 추출을 그대로 쓰고, **이미지·스캔 PDF**(기존엔 metadata-only
>   placeholder로 빠지던 파일)만 서비스로 보낸다. 실패 시 `sampleOrMetadataDocument`로 폴백.
> - **Phase 3** — **콘텐츠 기반 하이브리드**(`FINPROOF_OCR_PROVIDER=hybrid`,
>   `createHybridOcrProvider`). 파일 유형별로 측정상 최선의 엔진 선택: 디지털 PDF·DOCX는 이
>   서비스(pdfplumber/python-docx, 표 보존), **이미지·스캔 PDF는 OpenAI 비전**(Tesseract가
>   양식화된 한국어 광고 이미지에 약함), 텍스트는 로컬. 어떤 엔진이든 실패 시 폴백.

---

## 왜 별도 Python 서비스인가

|             | 기존 TS 추출                          | 이 서비스                                       |
| ----------- | ------------------------------------- | ----------------------------------------------- |
| PDF         | `pdftotext -layout` (텍스트 레이어만) | PyMuPDF 텍스트 + **스캔 페이지 Tesseract 폴백** |
| 표          | 소실                                  | pdfplumber로 TSV 보존 (`has_tables=true`)       |
| DOCX        | JSZip + 정규식 (표 구조 소실)         | python-docx로 **표 셀까지 보존**                |
| 이미지/스캔 | OCR 없음(placeholder 문자열)          | Tesseract `kor+eng` OCR                         |
| confidence  | 없음                                  | 0~1, 스캔 품질 반영                             |

---

## 추출 품질 실측 (레거시 pdftotext vs Python `/extract`)

> 측정 환경: 로컬 macOS, Tesseract 5.5.2(`kor+eng`), pdftotext(poppler) 26.04,
> 서비스 0.1.0. **측정일 2026-06-30.** `자수`=공백 제거 문자수,
> `표보존`=탭 구분 셀/행 휴리스틱(0=구조 소실), `정답유사도`=짝지어진 원문 `.txt`
> 대비 `difflib` 비율(공백 무시, **근사** ground truth). GT가 없는 칸은 비움.
> 레거시(TS) 경로는 심사 파이프라인이 실제로 호출하는 `pdftotext <file> -`
> (`-layout` 없음 + `\s+`→공백 평면화)를 그대로 실행해 비교했다 — 기존 코드 무수정.

| 문서           | 유형                         | TS 자수 | Py 자수         | TS 표보존 | Py 표보존 | Py conf   | Py provider | 정답유사도        |
| -------------- | ---------------------------- | ------- | --------------- | --------- | --------- | --------- | ----------- | ----------------- |
| 상품설명서     | 디지털 PDF                   | 709     | 709             | 0         | 0         | 0.95      | pymupdf     | TS=1.00 / Py=1.00 |
| 약관요약       | 디지털 PDF                   | 505     | 505             | 0         | 0         | 0.95      | pymupdf     | TS=0.99 / Py=0.99 |
| 내부체크리스트 | 디지털 PDF                   | 474     | 474             | 0         | 0         | 0.95      | pymupdf     | TS=0.99 / Py=0.99 |
| 금리표         | 표 PDF                       | 1399    | **2157** (+54%) | 0         | **65**    | 0.95      | pdfplumber  | (GT 없음)         |
| 약관(표 포함)  | 표 PDF                       | 2229    | **2615** (+17%) | 0         | **14**    | 0.95      | pdfplumber  | (GT 없음)         |
| 홍보물 배너    | 이미지 PNG                   | **0**   | 13~118          | 0         | 0         | 0.76~0.80 | tesseract   | TS=0.00 / Py=0.07 |
| 홍보물 배너    | 배너 PDF(텍스트레이어 ~50자) | 38      | 38              | 0         | 0         | 0.95      | pymupdf     | TS=0.04 / Py=0.04 |

### 정직한 결론

- **표 PDF(금리표·수수료표): 명확한 이점.** pdfplumber가 금리표를 18개 탭 구분
  행(한도/기한/금리/유형 4열)으로 보존하고 자수도 +54% 더 많다. 레거시 pdftotext는
  파이프라인의 `\s+`→공백 평면화로 행·열 경계가 **전부 소실**된다(표보존=0). 표가 있는
  금융 광고물에서 Python 경로가 분명히 낫다.
- **이미지/스캔 PNG: "무(無) → 유(有)".** 레거시는 이미지를 **전혀 못 읽어 0자**,
  Python은 Tesseract로 텍스트를 뽑아낸다(여기서만 가능). 다만 양식화된 한국어 배너에서
  Tesseract의 **절대 품질은 낮다**(13~118자, 정답유사도 0.07). confidence도 0.76~0.80으로
  자연히 **0.82 미만** → `hasLowOcrConfidence`가 정상 작동해 저신뢰로 표시된다. "있는 게
  없는 것보단 낫다"는 수준이지 고품질은 아니다 — 한국어 도메인 OCR 개선이 다음 과제.
- **디지털 텍스트 PDF: 유의미한 차이 없음.** 자수·정답유사도 모두 TS≈Py(709=709,
  1.00=1.00). pdftotext와 pymupdf가 동등하다. **Phase 2가 디지털 PDF는 로컬 추출에 그대로
  두고, placeholder로 빠지던 이미지·스캔 파일만 서비스로 보내는 설계가 이 데이터로 정당화된다.**
- **배너 PDF 주의:** 배너가 얇은 텍스트레이어(~50자)를 가진 PDF로 들어오면 pymupdf가
  OCR 폴백 없이 그 레이어를 그대로 취해 Python≈레거시가 된다. 이점은 **진짜 이미지 파일 /
  텍스트레이어 없는 스캔**에서만 발현된다.

---

## Phase 3 — 하이브리드 라우팅의 근거 (GPT 비전 vs Python)

위 실측은 "레거시 vs Python"이었다. Phase 3 하이브리드를 정하기 위해 **GPT 비전(`gpt-5-mini`,
프로덕션과 동일 프롬프트) vs Python**을 같은 문서로 추가 실측했다(측정일 2026-06-30, 키는 EC2
내에서만 사용).

| 문서         | 유형   | Python                 | GPT 비전     | jeonbuk 정답유사도     |
| ------------ | ------ | ---------------------- | ------------ | ---------------------- |
| jeonbuk 배너 | 이미지 | tesseract 13자         | **293자**    | Py 0.07 → **GPT 0.77** |
| Viet 배너    | 이미지 | tesseract 118자        | **431자**    | (GT 없음)              |
| 금리표       | 표 PDF | pdfplumber **2,157자** | 비전 1,263자 | (GT 없음)              |

- **이미지: GPT 비전 압승.** tesseract는 jeonbuk 배너에서 `누구나 빠르게 … 승인 가능한`(13자)만
  뽑은 반면, GPT는 `최저 연 4.9%`·`최대한도 8,000만원`·`연체 시 최고 연 15%`·`준법감시인 심의필
제2026-06-LOAN-D01호` 등 **심의에 결정적인 컴플라이언스 고지문을 전부** 포착했다.
- **표 PDF: Python(pdfplumber)이 더 완전.** GPT도 표를 `|` 구분으로 잘 재구성하지만, 단일
  렌더 이미지 + 출력 토큰 상한 때문에 긴 문서 후반부에서 잘린다. pdfplumber는 PDF 전체를
  무료·결정적으로 추출한다.

→ 그래서 하이브리드는 **이미지·스캔 → GPT 비전, 디지털 PDF·DOCX → 이 서비스, 텍스트 → 로컬**로
라우팅한다. PDF는 로컬 `pdftotext`로 텍스트레이어 유무를 먼저 탐지해 디지털(서비스) vs
스캔(비전)을 가른다.

> ⚠️ GPT 비전의 절대 품질 수치(자수)는 측정했으나, RAG 검색 지표 전후(아래 Part C)는 여전히
> **미측정**이다.

---

## 응답 계약 (`ExtractResponse`)

TS의 `ExtractedDocument`(`src/server/analysis/review-analysis-pipeline.ts`)와 **정합**한다.

```jsonc
{
  "text": "추출 본문 (+ 표 TSV)",
  "confidence": 0.95, // 0~1, ExtractedDocument.confidence와 동일 스케일
  "provider": "pymupdf", // pymupdf | pdfplumber | tesseract | python-docx
  "pages": 3,
  "has_tables": true,
  "warnings": []
}
```

### confidence 산정 규칙 (0.82 임계 호환)

FinProof는 `confidence < 0.82`를 **저신뢰 OCR**로 본다
(`review-subagents.ts:hasLowOcrConfidence`, `model-router.ts:ocr_visual_understanding`).
이 서비스의 confidence도 동일 스케일이며, 스캔 품질이 낮으면 **자연히 0.82 미만**이 나온다.

| 입력                      | confidence                             | provider                            |
| ------------------------- | -------------------------------------- | ----------------------------------- |
| 텍스트 레이어 PDF 페이지  | 0.95                                   | `pymupdf` (표 감지 시 `pdfplumber`) |
| 스캔 PDF 페이지 / 이미지  | Tesseract 단어별 conf 평균 ÷ 100 (0~1) | `tesseract`                         |
| DOCX                      | 0.97                                   | `python-docx`                       |
| 추출 실패 / 손상 / 미지원 | **0.0** + warning (500 아님)           | `none` / `error` / `timeout`        |

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

| 환경변수                  | 기본값   | 설명                                                                                                                                                              |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FINPROOF_OCR_PROVIDER`   | (미설정) | **`hybrid`**(권장, 유형별 라우팅) / `http`(서비스만, `python_service` 별칭) / `openai`·`gemini`(비전만) / `http_json`(레거시). **미설정이면 기존 동작 100% 동일** |
| `FINPROOF_OCR_ENDPOINT`   | —        | 서비스 베이스 URL (예: `http://localhost:8000`). `http`·`hybrid`일 때 필수                                                                                        |
| `OPENAI_API_KEY`          | —        | `hybrid`(이미지/스캔 비전)·`openai`일 때 필수                                                                                                                     |
| `FINPROOF_OCR_TIMEOUT_MS` | `30000`  | 호출 타임아웃                                                                                                                                                     |

```bash
# Phase 3 하이브리드 (권장): 이미지→GPT 비전, 디지털 PDF·DOCX→서비스, 텍스트→로컬
FINPROOF_OCR_PROVIDER=hybrid \
FINPROOF_OCR_ENDPOINT=http://localhost:8000 \
OPENAI_API_KEY=sk-... \
npm run dev

# Phase 2 서비스 단독 (이미지/스캔도 서비스의 Tesseract로)
FINPROOF_OCR_PROVIDER=http \
FINPROOF_OCR_ENDPOINT=http://localhost:8000 \
npm run dev
```

> **레짐 통일(Phase 2)**: `FINPROOF_OCR_PROVIDER=http`를 정식 값으로 통일했다. 분석
> 파이프라인은 `defaultOcrProvider`에서 `isOcrServiceEnabled`(=`http`/`python_service`)를
> **직접** 보고 Python 멀티파트 클라이언트(`createPythonServiceOcrProvider`)로 분기하므로,
> 켜면 **지식 인제스천(Phase 1)과 심사 파일 OCR(Phase 2) 둘 다** 이 서비스를 탄다. 미설정이면
> 양쪽 모두 기존 동작 그대로다.
>
> - `provider-config.ts`는 `http`를 독립적으로 인식해 `FINPROOF_OCR_ENDPOINT` 누락을
>   `missing`으로 보고한다(검증용).
> - 레거시 JSON-batch OCR API(`createHttpOcrProvider`, storage key를 JSON으로 POST)는
>   삭제하지 않고 **명시적 `http_json` 값**으로만 도달하도록 보존했다 — 정식 `http`를 가리지 않는다.
> - `python_service`는 계속 동작한다(기존 배포/스크립트 하위호환).

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

| 지표                       | Before (OCR OFF) | After (python_service) | Δ      |
| -------------------------- | ---------------- | ---------------------- | ------ |
| context_precision          | 미측정           | 미측정                 | 미측정 |
| context_recall             | 미측정           | 미측정                 | 미측정 |
| issue_detection F1         | 미측정           | 미측정                 | 미측정 |
| risk under_classified_rate | 미측정           | 미측정                 | 미측정 |

> ℹ️ **추출 단계 품질은 위 [추출 품질 실측](#추출-품질-실측-레거시-pdftotext-vs-python-extract)
> 섹션에서 실측 완료**(표 보존 +54% 자수, 이미지 0자→OCR). 아래 RAG **검색 지표**(context_precision 등)는
> 별개 측정이며 **여전히 미측정**이다 —
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
