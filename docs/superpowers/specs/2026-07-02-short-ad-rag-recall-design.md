# 짧은 광고 RAG 리콜 개선 (B) — 설계

**날짜:** 2026-07-02
**브랜치:** `fix-rag-short-ad-recall` (배포 커밋 `008b865` 기준)
**선행 작업:** (A) 플레이스홀더 메타데이터 오염 제거 — `analysisRagQuery`가 OCR 추출 텍스트만으로 쿼리 구성 (배포 완료, `008b865`)

## 문제 (B)

짧은 마케팅 광고와 형식적 규정 텍스트 사이의 어휘·의미 격차가 검색 3단계를 모두 통과하지 못하게 한다. rc-upload-002의 특판 포스터(64자, `"긴급특판! 500억 한도! 연5.5% 한도 소진 시 조기 종료!"`)로 실측:

| 단계 | 온-포인트 규정 점수 | 임계 | 통과 |
|---|---|---|---|
| 벡터 코사인 | 공통체크 0.286 / 예금체크 0.361 / FSS 0.315 | 0.4 | ❌ |
| Cohere 리랭크 | 전부 0.03~0.056 (온·오프타깃 구분 미미) | — | ❌ |
| 렉시컬(토큰중복) | 광고 "한도 소진 조기 종료" vs 규정 "한정/선착순" → 공유 토큰 없음 | 0.4 | ❌ |

즉 광고와 규정이 **같은 개념(희소성·압박)을 다른 단어로** 표현해 어느 경로도 연결하지 못한다. 추가로 `product_type=image_test` 같은 스코핑이 `예금 체크리스트`(product_type=deposit)를 후보에서 배제한다.

## 목표

실제 짧은 광고(배너·SNS 카피 등)에 대해 온-포인트 규정이 후보 풀에 진입하도록 검색 리콜을 전역 개선한다. 정상 케이스(rc-upload-001 등) 회귀는 없어야 한다.

## 비목표

- 리랭커 자체 교체/파인튜닝
- 전문검색(tsvector/pg_trgm)으로의 렉시컬 채널 전면 교체 (B-iii, 별도 과제)
- product_type 데이터 교정 (데이터 품질, 별도)

## 접근

### B-i: LLM 쿼리 확장 (핵심)

어휘 격차를 근본에서 메우기 위해, 검색 전 LLM으로 광고를 컴플라이언스 위험 개념어로 확장한다.

**신규 모듈** `src/server/analysis/query-expansion.ts`
- `expandComplianceQuery(adText: string, modelProvider: ModelProvider): Promise<string>`
- 입력: OCR 추출 광고 텍스트.
- 출력: 광고에 담기거나 암시된 **컴플라이언스 위험 개념 키워드**(한국어). 예: `"한정판매 선착순 희소성 오인유도 마감임박 압박판매 확정수익 오인 최상급표현"`.
- 저비용·고속 모델(`modelProvider` / model-router). 분석당 **1회** 호출.
- **증강(대체 아님):** 최종 쿼리 = `${광고텍스트} ${개념어}`. (A) 수정을 보존하고 개념어를 덧붙인다.
- **폴백:** LLM 실패/타임아웃/빈 응답 → 빈 문자열 반환(개념어 없이 광고텍스트만 사용 = 현재 동작). 논블로킹, 로깅.

**배선** (`review-analysis-pipeline.ts`)
- `run()`에서 추출 직후 `conceptTerms = await expandComplianceQuery(extractedText, modelProvider)`를 1회 계산.
- `RagRetrieveInput`에 `queryConcepts?: string` 추가로 검색기에 전달.
- `analysisRagQuery(review, docs, concepts?)`가 개념어를 뒤에 append.
- 검색 쿼리(임베딩+렉시컬)와 **리랭크 쿼리 양쪽**에 동일 적용.

### B-ii: checklist/guide 문서 전면 편입

`prisma-review-store.ts`의 `searchKnowledgeEvidence` — 벡터 SQL과 Prisma 렉시컬 필터 **양쪽**:
- 현재: `(product_type = $N OR product_type IS NULL)`
- 변경: `(product_type = $N OR product_type IS NULL OR document_type IN ('checklist','guide'))`

체크리스트/가이드는 컴플라이언스 핵심 문서이고 개수가 적어(3~4개), product_type 무관하게 항상 후보에 넣고 B-i 확장쿼리+리랭크가 관련도로 정렬하게 한다. 잘못된 태깅(image_test)에도 강건.

## 데이터 흐름

```
OCR 추출 → 광고텍스트
        → [B-i] expandComplianceQuery(광고텍스트) → 개념어 (실패시 "")
        → analysisRagQuery = 광고텍스트 + 개념어
        → 검색: 벡터(임베딩) + 렉시컬  ─┐
          (B-ii: checklist/guide 항상 편입)│
        → 리랭크(동일 확장쿼리)          │
        → selectEvidenceCandidates(f45b1fc 지식 top-1 보장)
        → 서브에이전트 이슈별 근거 부착
```

## 오류 처리

- LLM 확장 실패: 빈 개념어로 폴백, 파이프라인 계속. (A) 동작으로 안전 강등.
- 임베딩/검색 오류: 기존 처리 유지(벡터 실패 시 렉시컬 폴백).

## 테스트 (TDD)

- `query-expansion.test.ts`: 모킹 modelProvider → 개념어 파싱/정규화; 실패·빈 응답 시 `""` 폴백.
- `review-analysis-pipeline.test.ts`: 개념어가 검색·리랭크 쿼리에 포함됨을 assert; 확장 실패해도 파이프라인 정상 완료.
- `prisma-review-store` 관련 테스트: image_test 스코프에서도 checklist/guide 후보 포함 assert.
- 회귀: 기존 analysis 98개 그린 유지 + rc-upload-001 재분석 6/6 유지.

## 검증 & 롤아웃

1. **비파괴 A/B(배포 전):** 실제 API로 002 광고 → 확장쿼리 임베딩 코사인/리랭크가 온-포인트 체크리스트를 바닥값 위로 올리는지 재현.
2. 커밋 → personal 푸시 → `deploy-*` 태그 → Deploy EC2.
3. 001·002 재분석 → 근거 부착 검증.

## 리스크

- **비용/지연:** 분석당 LLM 1회 추가(~1–3s). 저비용 모델로 완화, 폴백으로 가용성 보장.
- **정상 케이스 노이즈:** checklist/guide 전면 편입으로 타 상품 체크리스트가 후보에 들어올 수 있으나, 개수 적고 확장쿼리+리랭크가 down-rank. 001 재분석으로 회귀 확인.
