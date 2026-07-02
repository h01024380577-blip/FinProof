# 사회맥락 리스크 Agent 개발 정리

## 목표

기존 심의 Agent 팀 구조를 유지하면서 `social_context_risk` Agent를 추가했다. 이 Agent는 법령 위반을 확정하지 않고, 홍보물의 문구, 이미지 단서, 게시일, 상징, 타겟 고객, 캠페인명을 바탕으로 사회적 논란 가능성, 역사적 민감성, 소비자 정서 충돌 가능성을 사전 경고하는 역할만 맡는다.

## 처리 흐름

1. 홍보물 업로드 후 기존처럼 OCR/텍스트 추출을 수행한다.
2. RAG 검색 쿼리에 심의 제목, 계열사, 상품군, 채널, 게시 예정일, 요청 부서, 홍보 문구, 고지 문구, 상품 설명을 함께 넣는다.
3. 기존 도메인 Agent와 함께 `social_context_risk` Agent가 실행된다.
4. Agent는 승인된 지식문서와 업로드 자료에 근거가 있을 때만 사회맥락 이슈를 만든다.
5. `main_compliance` Agent가 기존 Agent 결과와 사회맥락 결과를 함께 받아 최종 종합한다.
6. 화면에서는 해당 이슈에 `사회맥락` 또는 `사회맥락 리스크` 배지를 표시한다.

## 코드 변경

- `src/server/analysis/review-subagents.ts`: 도메인 Agent 목록에 `social_context_risk`를 추가했다.
- `src/server/ai/prompt-registry.ts`: 사회맥락 리스크 전용 프롬프트를 추가했다.
- `src/server/ai/model-router.ts`: 모델 라우터 작업 유형에 `social_context_risk`를 추가했다.
- `src/server/analysis/review-analysis-pipeline.ts`: RAG 검색 쿼리를 캠페인명/게시일/채널 등 사회맥락 단서까지 포함하도록 보강했고, 이슈 저장 매핑에 새 Agent를 추가했다.
- `prisma/schema.prisma`, `src/domain/types.ts`, `src/generated/prisma/enums.ts`: Agent enum/type에 `social_context_risk`를 추가했다.
- `prisma/migrations/20260702161000_add_social_context_risk_agent_type/migration.sql`: DB enum 마이그레이션을 추가했다.
- `src/server/reviews/prisma-review-store.ts`, `src/server/reviews/mock-review-store.ts`: 저장소에서 새 Agent source를 인식하도록 했다.
- `src/components/workbench/IssueList.tsx`, `src/components/workbench/IssueDetailTabs.tsx`, `src/app/globals.css`: 사회맥락 이슈 배지를 표시하도록 했다.

## 테스트 변경

- 도메인 Agent 실행 순서 테스트에 `social_context_risk`를 추가했다.
- 모델 라우팅 테스트를 추가했다.
- 프롬프트 범위 테스트를 추가했다.
- 사회맥락 Agent finding이 기존 ReviewIssue 구조로 변환되는 테스트를 추가했다.
- 화면 배지 표시 테스트를 추가했다.

## 운영자가 따로 해야 할 일

1. 사회맥락 md 지식문서 7개를 기존 Knowledge Document 등록 기능으로 업로드한다.
2. 각 문서를 `guide` 또는 `checklist` 타입으로 지정한다.
3. 업로드 후 반드시 승인 처리한다. 승인되지 않은 문서는 RAG 근거로 사용되지 않는다.
4. 월간 이슈 문서와 긴급 이슈 문서도 같은 방식으로 업로드/승인한다.
5. 배포 환경에서 DB 마이그레이션을 적용한다.
6. 의존성 설치가 된 환경에서 Prisma client를 다시 생성한다.

## 권장 검증 시나리오

- 캠페인명/문구: `탱크데이`, `혜택 폭격`
- 게시일: 민감 기념일 또는 참사 추모일 근처
- 이미지: 탱크, 폭발 효과, 군사 상징
- 타겟: 청년층, 취약 차주, 재난 영향 지역

기대 결과는 법령 위반 확정이 아니라 `hold` 또는 `change_request` 성격의 사회맥락 리스크 경고다.

## 현재 확인 상태

`npm run db:generate`, `npm test`, `npm run lint`, `npm run build`는 통과했다. `next start` 기준 `/`, `/reviews`, `/api/v1/review-cases` 응답도 확인했다.

남은 운영 리스크는 실제 DB에 `20260702161000_add_social_context_risk_agent_type` 마이그레이션이 아직 적용되지 않았다는 점이다. 적용 전에는 서버가 뜨더라도 `social_context_risk` AgentRun/AgentFinding 저장 시 enum 값 불일치가 날 수 있다.

추가로 `next build`에서 local metadata storage adapter의 동적 파일 경로 때문에 Turbopack NFT trace 경고가 1건 발생한다. 빌드 실패는 아니지만, 장기적으로 local storage 파일 접근을 Next trace 범위 밖으로 분리하면 좋다.
