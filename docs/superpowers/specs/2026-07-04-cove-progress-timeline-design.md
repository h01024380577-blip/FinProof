# 교차 검증 단계를 사고과정 타임라인에 노출

날짜: 2026-07-04
브랜치: worktree-cove-progress-timeline

## 배경

심의자용 AI분석 실시간 사고과정 타임라인 팝업(`AnalysisProgressPopup`)은
`analysis_events` 테이블에 적재된 `stage:event` 이벤트를 폴링해 한국어 문구로
렌더링한다. CoVe 근거검증 단계(`runCoveEvidenceVerification`)는 파이프라인의
`combine:done` 이벤트 이후에 실행되지만 **진행 이벤트를 전혀 방출하지 않아**
타임라인에 보이지 않는다.

목표: CoVe 단계를 심의자가 이해하기 쉬운 언어("교차 검증")로 타임라인에
노출한다. "CoVe"라는 단어는 UI 문구에 노출하지 않는다.

## 결정 사항

- **세분화**: 5개 내부 단계(선별→검증질문 생성→근거대조 응답→판정→반영)를
  개별 노출하지 않고 **시작/완료 2줄**로 요약한다.
- **명칭**: "교차 검증" (기존 `evidence_verification` 서브에이전트의 "근거 검증"과
  구분).

## 변경 지점 (4곳)

### 1. `src/server/analysis/cove-verification.ts`
- `RunCoveInput`에 `onEvent?: AnalysisEventSink` 필드 추가.
- 파이프라인과 동일한 로컬 `emit()` 헬퍼(`onEvent?.(payload)`) 구성. emit 실패는 삼킴.
- 방출 2회:
  - `cove:start` — 선별(selection) 직후. payload `{ verifying }` = llm 모드로
    검증할 지적 수(`selection.filter(s => s.mode === "llm").length`).
  - `cove:done` — 판정/반영 후 반환 직전. payload `{ verified, suppressed, ms }`.
    - `verified` = verdict status `verified` 수.
    - `suppressed` = `drop` + `hold` + `downgrade` 수.
- CoVe 내부 LLM 오류는 이미 `errors[]`로 수집되어 throw하지 않으므로 `done`은
  항상 방출된다.

### 2. `src/server/analysis/review-analysis-pipeline.ts` (CoVe 호출부, ~line 2093)
- CoVe 호출 객체에 `onEvent` 전달 (서브에이전트 오케스트레이터가 넘기는 방식과 동일).
- 이 이벤트들은 `combine:done`보다 높은 seq를 받아 타임라인 끝에 붙는다.

### 3. `src/components/analysis/analysis-progress-copy.ts`
- `describeAnalysisEvent` switch에 case 추가:
  - `cove:start` → state `running`, "검토 결과를 근거와 교차 검증하고 있어요"
  - `cove:done` → state `done`, "교차 검증 완료 — N건 재확인"
    (suppressed>0이면 ", M건 근거부족으로 보류·제외" 덧붙임)

### 4. 테스트
- `analysis-progress-copy` 신규 case 단위 테스트 (기존 테스트 파일 패턴 따름).
- CoVe emit이 start/done을 정확한 payload로 호출하는지 검증
  (`cove-verification.test.ts`).

## 비목표

- 프론트엔드 `AnalysisProgressPopup.tsx`는 변경하지 않는다 (매퍼 출력을 그대로 렌더).
- CoVe 검증 로직 자체는 변경하지 않는다 (관측 이벤트만 추가).
- 5개 내부 단계의 개별 노출은 하지 않는다.

## 격리

전용 git worktree(`worktree-cove-progress-timeline`)에서 작업해 다른 세션과
브랜치 충돌을 방지한다.
