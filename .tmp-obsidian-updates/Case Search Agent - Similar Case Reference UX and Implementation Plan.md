# Case Search Agent - Similar Case Reference UX and Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 유사 심의사례 판단 서브에이전트를 추가하고, 체크리스트 탭의 `수정 제안` 아래에는 유사사례 ID와 복사/열기 액션만 최소 노출한다.

**Architecture:** `case_search` 서브에이전트는 과거 심의사례를 검색하고 현재 이슈에 참고 가능한 사례만 1-3건으로 필터링한다. UI는 판단 세부정보를 직접 노출하지 않고, 사례 ID 복사와 상세 이동만 제공해 현재 이슈 판단을 흐리지 않는다.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma, Postgres/pgvector, existing `ReviewAnalysisPipeline`, `ReviewStore`, `IssueDetailTabs`.

---

태그: #ai #rag #case-history #implementation-plan #ux

## 작성일

2026-05-27

## 결정 요약

체크리스트 탭에 유사도, 과거 최종 조치, 당시 문제 표현, 수정 후 승인 문구, 현재 적용 주의점까지 모두 표시하지 않는다.

이 정보는 심의자의 현재 이슈 판단을 오히려 흐릴 수 있다. 특히 과거 사례가 최신 법령/사내 기준보다 강한 근거처럼 보이면 안 된다.

따라서 1차 UX는 다음처럼 제한한다.

```text
수정 제안
  최고 금리 적용 조건, 한도, 세전/세후 기준을 본문 인접 영역에 명시해 주세요.

유사 심의사례
  CASE-2025-014  [복사] [열기]
  CASE-2025-031  [복사] [열기]
```

화면에 노출하는 정보:

- 유사 심의사례 ID
- ID 복사 버튼
- 사례 상세 열기/이동 버튼

화면에 노출하지 않는 정보:

- 유사도 점수
- AI가 판단한 참고 가능성 라벨
- 과거 최종 조치
- 당시 문제 표현
- 수정 후 승인 문구
- 현재 건에 적용 시 주의점

위 항목은 내부 필터링과 상세 화면에서만 사용한다.

## 제품 원칙

- 유사사례는 현재 판단을 대체하지 않고 참고 경로만 제공한다.
- 체크리스트 탭은 “현재 이슈와 수정 제안”이 주인공이어야 한다.
- AI 판단은 노출용 문구가 아니라 후보 선별과 정렬에 사용한다.
- 심의자는 원할 때만 과거 사례 상세로 이동한다.
- 복사 가능한 ID는 회의, 코멘트, 보고서 작성 시 빠르게 참조하기 위한 최소 단위다.

## 데이터 설계 방향

1차 구현은 기존 `Evidence` 모델을 활용한다.

- `Evidence.sourceType = "case_history"`
- `Evidence.documentId = 과거 심의사례 id`
- `Evidence.title = 과거 심의사례 표시 ID`
- `Evidence.quoteSummary = 내부 요약 또는 짧은 참조 설명`
- `Evidence.relevanceScore = 정렬용 점수`

체크리스트 UI에서는 `quoteSummary`와 `relevanceScore`를 숨긴다. 근거 자료 탭이나 사례 상세 화면에서는 필요할 때만 표시한다.

향후 사례 데이터가 커지면 별도 모델을 고려한다.

- `CaseHistoryChunk`
- `SimilarCaseReference`
- `ReviewIssueSimilarCase`

하지만 1차 구현에서는 새 테이블을 만들지 않고 `case_history` evidence를 재사용해 범위를 줄인다.

## 분석 파이프라인 설계

현재 흐름:

```text
OCR/Text Extraction
 → RAG 후보 검색
 → Reranker
 → creative_review / product_terms / evidence_verification
 → buildAnalysisIssues
 → persistAnalysisOutputs
```

목표 흐름:

```text
OCR/Text Extraction
 → RAG 후보 검색
 → Reranker
 → creative_review / product_terms / evidence_verification
 → case_search
 → buildAnalysisIssues
 → persistAnalysisOutputs
```

`case_search` Agent 책임:

- 현재 review와 issue 후보를 입력받는다.
- 유사한 과거 심의사례 후보를 검색한다.
- 현재 상품군/채널/표현과 관련성이 낮은 사례를 제외한다.
- 최신 규정이나 현재 상품자료보다 과거 사례를 우선하지 않도록 보수적으로 필터링한다.
- 각 이슈별 최대 3건만 반환한다.

## 구현 계획

### Task 1: 도메인 타입 확장 없이 case_history Evidence 표시 정책 고정

**Files:**

- Modify: `src/components/workbench/IssueDetailTabs.tsx`
- Test: `src/components/workbench/IssueDetailTabs.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`IssueDetailTabs.test.tsx`에 체크리스트 탭이 `case_history` 근거를 ID와 액션만 표시하는 테스트를 추가한다.

검증할 내용:

- `sourceType: "case_history"` evidence가 있으면 `유사 심의사례` 섹션이 보인다.
- `title`에 담긴 사례 ID가 보인다.
- `quoteSummary`, `relevanceScore`, 과거 조치 상세 문구는 보이지 않는다.

- [ ] **Step 2: 최소 구현**

`ChecklistPanel`에서 `issue.evidence.filter((item) => item.sourceType === "case_history")`를 계산한다.

렌더링 정책:

```tsx
<div className="similar-case-references">
  <span>유사 심의사례</span>
  {caseHistoryEvidence.slice(0, 3).map((evidence) => (
    <div key={evidence.id}>
      <code>{evidence.title}</code>
      <button type="button">복사</button>
      <a href={`/reviews/${evidence.documentId}`}>열기</a>
    </div>
  ))}
</div>
```

`documentId`가 없으면 열기 버튼은 숨긴다.

- [ ] **Step 3: 스타일 추가**

`src/app/globals.css`에 기존 체크리스트 패널 톤에 맞는 compact row 스타일을 추가한다.

스타일 원칙:

- 수정 제안보다 시각적 위계를 낮춘다.
- 한 줄 row로 표시한다.
- ID는 monospace로 표시한다.
- 복사/열기 버튼은 작은 보조 액션으로 표시한다.

- [ ] **Step 4: 테스트 실행**

Run:

```bash
npm run test -- src/components/workbench/IssueDetailTabs.test.tsx
```

Expected:

- 신규 테스트 통과
- 기존 IssueDetailTabs 테스트 통과

### Task 2: case_search 서브에이전트 타입 연결

**Files:**

- Modify: `src/server/analysis/review-subagents.ts`
- Modify: `src/server/analysis/review-analysis-pipeline.ts`
- Test: `src/server/analysis/review-analysis-pipeline.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`review-analysis-pipeline.test.ts`에 `case_search` 결과가 `case_history` evidence로 findings에 포함되는 테스트를 추가한다.

테스트 조건:

- 가짜 `subAgentOrchestrator`가 `case_search` finding을 반환한다.
- 반환된 finding의 evidence 중 `sourceType`이 `case_history`인 항목이 유지된다.
- `persistAnalysisOutputs`에서 issue evidence로 저장 가능한 형태다.

- [ ] **Step 2: ReviewSubAgentId 확장**

`ReviewSubAgentId`에 `"case_search"`를 추가한다.

```ts
export type ReviewSubAgentId =
  | "creative_review"
  | "product_terms"
  | "evidence_verification"
  | "case_search";
```

- [ ] **Step 3: subAgents에 case_search 추가**

`subAgents` 배열에 다음 역할을 추가한다.

```ts
{
  id: "case_search",
  task: "case_search",
  instructions:
    "You are a Korean financial advertising case history search agent. Identify prior review cases that may be useful references for the current issue. Return only JSON."
}
```

- [ ] **Step 4: 모델 라우팅 확인**

`src/server/ai/model-router.ts`에는 이미 `case_search` task가 존재한다. 신규 테스트에서 `provider.generateText`가 `task: "case_search"`로 호출되는지 확인한다.

- [ ] **Step 5: 테스트 실행**

Run:

```bash
npm run test -- src/server/analysis/review-analysis-pipeline.test.ts src/server/analysis/review-subagents.test.ts
```

Expected:

- `case_search` task 호출 검증 통과
- 기존 분석 파이프라인 테스트 통과

### Task 3: 유사사례 검색 메서드 추가

**Files:**

- Modify: `src/server/reviews/review-store.ts`
- Modify: `src/server/reviews/prisma-review-store.ts`
- Modify: `src/server/reviews/mock-review-store.ts`
- Test: `src/server/reviews/mock-review-store.knowledge-search.test.ts`
- Test: `src/server/reviews/prisma-review-store.integration.test.ts`

- [ ] **Step 1: 검색 인터페이스 정의**

`ReviewStore`에 `searchCaseHistoryEvidence`를 추가한다.

입력:

- `query`
- `productType`
- `affiliateId`
- `topK`
- `minScore`
- `queryEmbedding`
- `excludeReviewCaseId`

출력:

- `Evidence[]`
- 모든 항목은 `sourceType: "case_history"`

- [ ] **Step 2: Mock store 구현**

최종 상태가 `approved`, `change_requested`, `rejected`, `on_hold`인 과거 심의건만 검색 대상으로 삼는다.

현재 reviewCaseId와 같은 건은 제외한다.

- [ ] **Step 3: Prisma store 구현**

초기 구현은 `review_issues.target_text`, `review_issues.title`, `review_issues.description`, `review_cases.title`, `review_cases.product_type` 기반 lexical search로 시작한다.

pgvector 인덱스가 안정화되면 case history chunk 기반 vector search로 확장한다.

- [ ] **Step 4: 테스트 실행**

Run:

```bash
npm run test -- src/server/reviews/mock-review-store.knowledge-search.test.ts src/server/reviews/prisma-review-store.integration.test.ts
```

Expected:

- 현재 건 제외
- tenant scope 준수
- 최종 확정 사례만 반환

### Task 4: 파이프라인에 case_history 후보 주입

**Files:**

- Modify: `src/server/analysis/review-analysis-pipeline.ts`
- Test: `src/server/analysis/review-analysis-pipeline.test.ts`

- [ ] **Step 1: RAG 후보에 case history 추가**

`createLexicalRagRetriever`에서 승인 지식문서 검색과 별도로 `searchCaseHistoryEvidence`를 호출한다.

반환 후보는 `RagEvidenceCandidate` 형태로 정규화한다.

- [ ] **Step 2: 후보 개수 제한**

case history 후보는 issue별 최대 3건만 최종 evidence로 남긴다.

Checklist UI 노출도 최대 3건으로 제한한다.

- [ ] **Step 3: 안전 조건 추가**

다음 조건을 적용한다.

- 현재 reviewCaseId 제외
- tenantId scope 필수
- 같은 productType 우선
- 최종 상태가 확정된 과거 사례만 포함

- [ ] **Step 4: 테스트 실행**

Run:

```bash
npm run test -- src/server/analysis/review-analysis-pipeline.test.ts
```

Expected:

- `case_history` 후보가 rerank 대상에 포함된다.
- `case_history` 후보가 최종 findings evidence로 보존된다.

### Task 5: 복사/열기 UX 마감

**Files:**

- Modify: `src/components/workbench/IssueDetailTabs.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/workbench/IssueDetailTabs.test.tsx`

- [ ] **Step 1: 복사 동작 테스트**

`navigator.clipboard.writeText`를 mock 처리하고, 복사 버튼 클릭 시 사례 ID가 복사되는지 검증한다.

- [ ] **Step 2: 열기 링크 테스트**

`documentId`가 있는 case history evidence는 `/reviews/${documentId}` 링크를 렌더링한다.

`documentId`가 없는 evidence는 열기 링크를 렌더링하지 않는다.

- [ ] **Step 3: 접근성 문구 적용**

버튼 aria-label 예시:

- `CASE-2025-014 ID 복사`
- `CASE-2025-014 사례 열기`

- [ ] **Step 4: 테스트 실행**

Run:

```bash
npm run test -- src/components/workbench/IssueDetailTabs.test.tsx
```

Expected:

- 복사/열기 동작 테스트 통과
- 상세 정보 미노출 테스트 통과

## 수용 기준

- 체크리스트 탭의 수정 제안 아래에 유사 심의사례 ID가 최대 3건 표시된다.
- 유사도, 과거 조치, 문제 표현, 승인 문구, 적용 주의점은 체크리스트 탭에 표시되지 않는다.
- 각 사례 ID는 복사할 수 있다.
- 각 사례 ID는 상세 심의사례로 이동할 수 있다.
- `case_search` 서브에이전트는 파이프라인에서 실행된다.
- 과거 사례는 현재 건과 tenant scope를 침범하지 않는다.
- 과거 사례는 최신 규정/현재 상품자료보다 우선 근거로 표시되지 않는다.

## Related

- [[04 Data AI/Future Plan - Case History RAG]]
- [[04 Data AI/Agent and RAG Requirements]]
- [[11 Specs/Agent RAG Technical Specification]]
- [[08 Decisions/Decision 016 - AI Model Routing Baseline]]
