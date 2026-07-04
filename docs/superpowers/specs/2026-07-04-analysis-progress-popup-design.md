# 분석 진행상황 팝업 (Agent Progress Popup) — 설계

작성일: 2026-07-04
상태: 승인됨 (구현 계획 작성 예정)

## 목적

심의자가 AI 분석이 도는 동안(그리고 끝난 뒤에도) **어떤 에이전트가 어떤 근거를
검토하며 어떻게 판단에 이르렀는지**를 사람이 이해하기 쉬운 언어로 볼 수 있게 한다.
Claude/GPT의 "생각 과정" 스트리밍, 그리고 이미 구현된 심의 채팅 UI와 유사한 경험을
목표로 한다.

## 배경 / 제약

- 프로덕션은 **queued 모드**: 분석 파이프라인은 Next.js 앱과 **별개 프로세스**인
  분석 워커(`scripts/run-analysis-worker.ts`)에서 실행된다. 프론트엔드는 워커 메모리에
  접근할 수 없고, 앱 API만 호출할 수 있다. **앱과 워커가 공유하는 유일한 표면은 DB.**
- 심의 채팅의 실시간 스트리밍(NDJSON over `ReadableStream`,
  `src/server/reviews/review-chat-stream.ts`)은 **요청 안에서 작업이 도는** 경우에만
  성립한다. 분석은 별도 워커라 이 패턴을 그대로 못 쓴다.
- 현재 단계별 구조화 로그(`src/server/analysis/analysis-log.ts`의 `logAnalysisEvent`)는
  stdout → CloudWatch로만 나가고 **DB에 저장되지 않으며 API로도 노출되지 않는다.**
- `agent_runs`는 파이프라인이 **전부 끝난 뒤** `persistAnalysisOutputs`에서 한꺼번에
  기록된다(실시간 아님). `analysis_jobs.currentStep`은 5개 coarse 값만
  (`queued → worker_running → outputs_persisting → outputs_persisted → worker_completed`).

## 확정된 요구사항

- **보존**: 완료 후에도 전체 흐름을 다시 확인 가능(정적 타임라인). 재생 애니메이션은 아님.
  → 이벤트를 DB에 영구 저장.
- **상세도**: 사람말 서술 + 핵심근거(찾은 규정/문서 제목, 에이전트별 발견 개수). 모델명·
  tier·원시 점수 같은 내부정보는 노출하지 않는다.
- **위치**: 큐 화면과 케이스 상세 화면 양쪽에서 열 수 있는 공용 컴포넌트.
- **실시간성**: 크로스-프로세스 제약상 완전한 push 스트리밍은 불가. 1.5초 폴링으로 갈음.

## 채택 접근법 (A안)

`logAnalysisEvent`(및 파이프라인/서브에이전트의 이벤트 발생 지점)가 콘솔 로그와 함께 새
`analysis_events` 테이블에도 기록한다. 새 엔드포인트가 이벤트를 시간순으로 반환하고,
팝업이 이를 폴링해 사람 언어로 렌더한다. 완료 후엔 전체를 1회 로드해 정적 타임라인으로
보여준다.

기각한 대안:
- **B. 기존 status의 coarse currentStep만 사용** — 에이전트별 사고 과정이 안 보여 요구 미충족.
- **C. 워커에서 SSE 실시간 스트리밍** — 워커가 별도 프로세스라 DB 경유 없이는 프론트로
  전달 불가.

## 설계 상세

### ① 데이터 모델

새 Prisma 모델 `AnalysisEvent` → 테이블 `analysis_events`:

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | BigInt, autoincrement, PK | 폴링 커서(monotonic). 병렬 서브에이전트 insert 순서도 안전 |
| `tenantId` | String | 멀티테넌시 스코프 (기존 store 규약과 일치) |
| `reviewCaseId` | String | 케이스 ID |
| `jobId` | String | 해당 분석 잡 ID |
| `stage` | String | `pipeline`/`ocr`/`rag_retrieve`/`rerank`/`evidence_select`/`orchestrate`/`subagent`/`combine` |
| `event` | String | `start`/`done` 등 |
| `payload` | Json | 원본 이벤트 페이로드(개수·제목·에이전트 id 등) |
| `createdAt` | DateTime, default now | 표시용 타임스탬프 |

- 인덱스: `(reviewCaseId, id)`.
- 잡당 약 15~20행. 잡과 함께 영구 보존.

### ② 이벤트 기록 경로

- 파이프라인(`review-analysis-pipeline.ts`)과 서브에이전트(`review-subagents.ts`)는
  이벤트를 **주입된 sink**로 보낸다. 기본 sink는 현재처럼 콘솔 로그만
  (`logAnalysisEvent`). 워커/inline 실행 경로는 **콘솔 + DB insert** sink를 주입한다
  (해당 실행의 `tenantId`/`reviewCaseId`/`jobId`를 클로저로 보유).
- DB insert 실패가 분석을 중단시키면 안 된다 → try/catch로 감싸고 실패 시 콘솔 로그로만
  폴백 (`logAnalysisEvent`의 기존 원칙과 동일).
- 콘솔 로그(CloudWatch)는 그대로 유지 — 기존 관측 경로를 깨지 않는다.

### ③ API

`GET /api/v1/review-cases/{caseId}/analysis/events?since=<id>`
- `since` 이후(id > since) 이벤트를 `id` 오름차순으로 반환.
- 응답: `{ events: Array<{ id, stage, event, payload, createdAt }>, jobId, status }`
  (status는 진행 중/완료 판단용으로 최신 잡 상태를 함께 실어 폴링 종료 조건에 활용).
- 인증/스코프는 기존 review-case 라우트 규약(role, tenant) 준수.

### ④ 사람 언어 매핑 (순수 함수)

`(stage, event, payload) → { icon, text, evidenceChips? }` 매핑을 순수 함수로 구현한다
(단위테스트 대상). 예:

```
pipeline:start                → "심의를 시작합니다"
ocr:done(docs=3)              → "첨부 3건에서 내용을 읽었어요"
query_expansion:done          → "핵심 개념을 뽑아 관련 규정을 찾을 준비를 했어요"
rag_retrieve:done(37)         → "관련 규정·사례 후보 37건을 찾았어요"
rerank:done(topDocs)          → "가장 관련 높은 근거를 선별했어요"  칩: [전자금융감독규정 §5, 광고심의지침 §12 …]
evidence_select:done(titles)  → "심사 근거 6건 확정 (규정4·상품설명2)"
orchestrate:start             → "전문 에이전트들이 검토를 시작해요"
subagent:start(regulation)    → "⚖️ 규정 위반 여부를 검토하고 있어요…"
subagent:done(regulation,3)   → "⚖️ 규정 검토 완료 — 3건 지적"
subagent(main)                → "🧭 모든 검토를 종합하고 있어요…"
combine:done(22)              → "분석 완료 — 총 22개 항목 도출"
```

에이전트 id → 친근한 라벨 매핑:

| id | 라벨 |
|---|---|
| creative_review | 광고 표현 심의 |
| product_terms | 상품 조건 확인 |
| regulation | 규정 위반 검토 |
| internal_policy | 내부 지침 검토 |
| social_context_risk | 사회적 맥락 리스크 |
| evidence_verification | 근거 검증 |
| case_search | 유사 사례 탐색 |
| main | 최종 종합 판단 |

알 수 없는 stage/agent는 안전한 기본 문구로 폴백(크래시 금지).

### ⑤ 프론트엔드

- 공용 컴포넌트 `AnalysisProgressPopup` — 기존 `chat-widget`처럼 `role="dialog"` 플로팅
  패널(별도 모달 primitive가 없으므로 이 패턴을 따른다).
- 진입 버튼:
  - 큐: `src/components/queue/QueueTable.tsx`의 "분석중/대기중" 라벨 옆.
  - 상세: `src/components/ReviewDetailWorkspace.tsx`.
- 동작:
  - 열리면 이벤트 폴링. 최신 잡이 진행 중(queued/running)이면 1.5초 간격으로 `since`
    커서를 올리며 새 이벤트 append.
  - 완료(completed/failed)면 전체 1회 로드 후 폴링 중단, 정적 타임라인 표시.
  - 각 항목: 상태 아이콘(진행중 스피너 / 완료 체크) + 서술 문구 + 근거 칩(있으면).
  - 실패 시 마지막에 오류 문구.

### ⑥ 테스트

- 사람 언어 매핑 함수: 단위테스트(각 stage/event/agent, 미지값 폴백).
- 이벤트 엔드포인트: `since` 필터·정렬·스코프.
- 이벤트 sink: DB 실패 시 분석 비중단(폴백) 검증.
- 팝업 컴포넌트: 진행중/완료/실패 렌더.

### ⑦ 배포

- Prisma 마이그레이션으로 프로덕션 Supabase에 `analysis_events` 생성. 배포 파이프라인의
  마이그레이션 적용 방식 확인 후 반영.
- 커밋은 org 레포(sprint-0), 배포 트리거는 personal `deploy-*` 태그(기존 관례).

## 범위 밖 (YAGNI)

- 완료된 분석의 재생/타임랩스 애니메이션.
- 모델·tier·토큰·점수 등 내부 지표 노출.
- 이벤트 push(웹소켓/SSE) — 폴링으로 충분.
- 이벤트 보존기간 정책/청소 배치(초기엔 무기한 보존, 필요 시 후속).

## 미해결 확인 항목 (구현 계획 단계에서 확정)

- 배포 파이프라인이 `prisma migrate deploy`를 자동 실행하는지, 수동 적용이 필요한지.
- BigInt id의 JSON 직렬화 처리(문자열화) 방식.
