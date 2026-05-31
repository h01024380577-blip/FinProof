# Future Plan - Case History RAG

> 문서 용도: 현재 AI 분석 파이프라인에서 심의이력 활용 여부를 정리하고, 추후 과거 심의사례 기반 RAG/Agent 확장 계획을 기록합니다.

태그: #ai #rag #case-history #roadmap #future-plan

## 작성일

2026-05-27

## 현재 상태

현재 자동 AI 분석 파이프라인은 **DB에 쌓인 과거 심의건, 심의결과, 감사이력을 직접 검색해 참고하지 않는다.**

현재 분석 시 참고하는 근거는 다음 두 축이다.

- 현재 업로드된 심의자료
  - OCR/Text extraction으로 본문을 추출한다.
  - 추출 결과는 `product_doc` 근거 후보로 사용된다.
- 승인된 지식문서
  - `searchKnowledgeEvidence`를 통해 `knowledge_documents` / `evidence_chunks`에서 검색한다.
  - 금융규제 가이드라인, 내부 정책, 체크리스트처럼 등록 후 승인된 자료가 여기에 해당한다.

코드상 `case_history`, `case_search`, `similar_case` 같은 개념은 타입과 모델 라우팅 후보에 존재하지만, 현재 `ReviewAnalysisPipeline.run` 실행 흐름에는 과거 심의사례 검색 단계가 연결되어 있지 않다.

## 문제 인식

FinProof Agent의 제품 가치는 단순 규정 검색보다 “이전에는 유사한 광고를 어떻게 판단했는가”를 함께 보여줄 때 커진다.

준법심의자는 법령/내부 기준뿐 아니라 과거 판단의 일관성도 중요하게 본다. 특히 다음 상황에서는 심의이력 참고가 필요하다.

- 같은 상품군에서 반복되는 금리/혜택 표현
- 과거에는 승인됐지만 현재 기준에서는 주의가 필요한 표현
- 수정 후 승인된 문구 재사용
- 계열사별 내부 심의 관행 차이
- Reviewer가 수동으로 유사 사례 검토를 요청하는 경우

## 발전 방향

### 1. 심의사례 인덱스 구축

최종 상태가 확정된 심의건만 사례 인덱스에 반영한다.

대상 데이터:

- 최종 심의 상태: 승인, 수정요청, 반려, 보류
- 이슈 유형과 위험도
- 원문 문제 표현
- Reviewer 최종 판단
- 수정 권고 문구
- 최종 승인 문구
- 관련 상품군, 채널, 계열사, 심의일자
- 판단 당시 적용된 정책/가이드라인 버전

초기에는 `review_issues`, `evidence`, `review_cases`를 기반으로 사례 chunk를 생성하고, 이후 별도 `case_history_chunks` 또는 `evidence_chunks` 확장 구조로 운영한다.

### 2. Case Search Agent 추가

현재 서브에이전트는 `creative_review`, `product_terms`, `evidence_verification` 중심이다. 이후 `case_search` Agent를 실제 파이프라인에 연결한다.

역할:

- 현재 광고 문안과 유사한 과거 심의사례 검색
- 과거 판단과 현재 판단의 일관성 검토
- 과거 사례가 현재 법령/사내 기준보다 앞서지 않도록 보수적 검증
- 유사 사례가 판단에 강하게 영향을 줄 경우 상위 모델 검수 요청

주의점:

- 과거 사례는 보조 근거이며, 최신 법령/감독 규정/사내 기준보다 우선할 수 없다.
- 과거 승인 사례가 있더라도 현재 자료와 조건이 다르면 그대로 승인 근거로 사용하지 않는다.
- 사례 검색 결과에는 심의일자, 상품군, 적용 기준 버전, 최종 조치가 함께 표시되어야 한다.

### 3. RAG 근거 우선순위 반영

향후 분석 근거 우선순위는 다음과 같이 운영한다.

1. 현재 업로드된 상품자료
2. 최신 법령/감독 규정
3. 최신 사내 심의기준
4. 상품군 체크리스트
5. 과거 심의사례

과거 심의사례는 “유사 판단 참고”에는 유용하지만, 규정 판단의 1차 근거가 되어서는 안 된다.

### 4. UI/UX 표시 방식

심의 상세 화면의 체크리스트 탭에서는 `수정 제안` 아래에 “유사 심의사례”를 최소 정보로만 표시한다.

표시 항목:

- 유사 심의사례 ID
- ID 복사 버튼
- 사례 상세 열기/이동 버튼

표시하지 않는 항목:

- 유사도 점수
- 과거 최종 조치
- 당시 문제 표현
- 수정 후 승인 문구
- 현재 건에 적용 시 주의점

위 상세 정보는 현재 판단을 흐릴 수 있으므로 체크리스트 탭에서는 노출하지 않는다. `case_search` Agent는 내부적으로 유사도와 적용 가능성을 판단하되, UI는 상위 1-3개 사례의 ID와 액션만 제공한다.

채팅 답변에서는 내부 ID, chunk id, 업로드 파일명을 노출하지 않는다. 유사사례를 언급해야 할 경우에도 사람이 읽을 수 있는 사례 ID 또는 제목 수준으로 제한한다.

구체 구현 계획은 [[11 Specs/Case Search Agent - Similar Case Reference UX and Implementation Plan]]을 따른다.

### 5. 품질/감사 요구사항

- Case Search 결과를 사용한 경우 `agent_runs`와 `agent_findings`에 검색 입력, 후보 수, 선택된 사례 id를 기록한다.
- Reviewer가 사례 근거를 채택/기각할 수 있어야 한다.
- 기각 사유는 향후 검색 품질 개선 데이터로 활용한다.
- tenant/계열사 경계를 넘어 사례가 노출되지 않도록 scope 필터를 강제한다.

## 구현 제안 순서

1. 최종 확정 심의건에서 사례 chunk 생성 스키마 정의
2. 기존 `evidence_chunks`를 재사용할지, 별도 `case_history_chunks`를 둘지 결정
3. `ReviewStore`에 유사 심의사례 검색 메서드 추가
4. `ReviewAnalysisPipeline.run`에 Case Search 단계 추가
5. `review-subagents.ts`에 `case_search` Agent 연결
6. 모델 라우터의 `case_search` task를 실제 호출 흐름과 연결
7. UI에 유사 심의사례 패널 추가
8. 감사로그/AgentRun에 사례 검색 결과 기록
9. 테스트 데이터로 승인/수정/반려 사례를 seed
10. 회귀 테스트: 과거 사례가 최신 규정보다 우선 적용되지 않는지 검증

## 관련 코드 앵커

- `src/server/analysis/review-analysis-pipeline.ts`
- `src/server/analysis/review-subagents.ts`
- `src/server/ai/model-router.ts`
- `src/server/reviews/prisma-review-store.ts`
- `src/server/reviews/review-store.ts`
- `src/app/api/v1/review-cases/[caseId]/chat/route.ts`

## Related

- [[04 Data AI/Agent and RAG Requirements]]
- [[02 Workflow/Roadmap]]
- [[11 Specs/Agent RAG Technical Specification]]
- [[11 Specs/Case Search Agent - Similar Case Reference UX and Implementation Plan]]
- [[08 Decisions/Decision 016 - AI Model Routing Baseline]]
