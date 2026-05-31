# Decision 017 - Case Search Agent Minimal Similar Case UX

> 문서 용도: 유사 심의사례 판단 서브에이전트와 체크리스트 탭 노출 범위에 대한 제품/UX 의사결정을 기록합니다.

태그: #decision #ai #rag #case-history #ux

## Status

Accepted

## Date

2026-05-27

## Context

FinProof Agent는 향후 현재 심의건과 유사한 과거 심의사례를 찾아 심의자의 판단을 보조해야 한다.

초기 아이디어는 체크리스트 탭의 `수정 제안` 아래에 다음 정보를 함께 표시하는 방식이었다.

- 유사도 / 참고 가능성
- 과거 최종 조치
- 당시 문제 표현
- 수정 후 승인 문구
- 현재 건에 적용 시 주의점

하지만 이 정보를 모두 현재 이슈 화면에 노출하면 심의자가 AI가 제시한 과거 사례에 과도하게 끌릴 수 있다. 특히 과거 승인 사례가 최신 법령, 감독 규정, 현재 상품자료보다 우선 근거처럼 보이면 준법 판단의 품질을 떨어뜨릴 수 있다.

따라서 유사사례 판단은 AI가 내부적으로 수행하되, 체크리스트 탭에서는 심의 흐름을 방해하지 않는 최소 정보만 제공해야 한다.

## Options

1. 체크리스트 탭에 유사도, 과거 조치, 문제 표현, 승인 문구, 적용 주의점을 모두 표시한다.
2. 체크리스트 탭에는 유사 심의사례 ID와 복사/열기 액션만 표시하고, 상세 정보는 사례 상세 화면에서 확인한다.
3. 유사사례를 체크리스트 탭에 표시하지 않고 별도 탭으로 분리한다.

## Decision

Option 2를 채택한다.

`case_search` 서브에이전트를 추가해 유사 심의사례를 검색하고 현재 이슈에 참고 가능한 사례를 내부적으로 선별한다. 단, 체크리스트 탭의 `수정 제안` 아래에는 최대 1-3개의 유사 심의사례 ID와 보조 액션만 표시한다.

체크리스트 탭 노출 항목:

- 유사 심의사례 ID
- ID 복사 버튼
- 사례 상세 열기/이동 버튼

체크리스트 탭 비노출 항목:

- 유사도 점수
- AI가 판단한 참고 가능성 라벨
- 과거 최종 조치
- 당시 문제 표현
- 수정 후 승인 문구
- 현재 건에 적용 시 주의점

화면 예시:

```text
수정 제안
  최고 금리 적용 조건, 한도, 세전/세후 기준을 본문 인접 영역에 명시해 주세요.

유사 심의사례
  CASE-2025-014  [복사] [열기]
  CASE-2025-031  [복사] [열기]
```

## Consequences

긍정적 영향:

- 체크리스트 탭의 핵심인 현재 이슈 설명과 수정 제안이 흐려지지 않는다.
- 과거 사례가 현재 판단의 주근거처럼 보이는 위험을 줄인다.
- 심의자는 필요한 경우에만 사례 상세로 이동해 맥락을 확인할 수 있다.
- 회의, 코멘트, 보고서 작성 시 사례 ID를 빠르게 복사해 참조할 수 있다.
- `case_search` Agent의 판단은 UI 노출 문구가 아니라 후보 선별과 정렬에 사용된다.

주의할 점:

- 유사사례 ID만으로는 맥락이 부족할 수 있으므로 상세 화면 이동이 반드시 제공되어야 한다.
- 사례 상세 화면에서는 최신 규정/현재 상품자료보다 과거 사례가 우선하지 않는다는 안내가 필요하다.
- tenant/계열사 범위를 넘어 사례가 노출되지 않도록 검색 scope를 강제해야 한다.
- 최종 확정 상태의 과거 심의건만 유사사례 후보로 사용해야 한다.

## Implementation Notes

1차 구현은 기존 `Evidence.sourceType = "case_history"`를 활용한다.

- `Evidence.documentId`: 과거 심의사례 id
- `Evidence.title`: 화면에 표시할 사례 ID
- `Evidence.quoteSummary`: 내부 요약 또는 상세 화면용 짧은 설명
- `Evidence.relevanceScore`: 정렬용 점수

체크리스트 탭에서는 `quoteSummary`와 `relevanceScore`를 노출하지 않는다.

상세 구현 계획은 [[11 Specs/Case Search Agent - Similar Case Reference UX and Implementation Plan]]을 따른다.

## Related

- [[08 Decisions/Decision Log]]
- [[04 Data AI/Future Plan - Case History RAG]]
- [[11 Specs/Case Search Agent - Similar Case Reference UX and Implementation Plan]]
- [[04 Data AI/Agent and RAG Requirements]]
- [[11 Specs/Agent RAG Technical Specification]]
- [[08 Decisions/Decision 016 - AI Model Routing Baseline]]
