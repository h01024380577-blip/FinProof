# Feature spec: 재검토(재업로드)·심의 버전·AI실패 직접검토·심의필

이 문서는 4개 요구사항의 단일 설계 기준이다. 모든 구현 서브에이전트는 이 문서를 먼저 읽고,
실제 코드(타입/스토어/서비스/라우트/UI) 정의를 직접 확인한 뒤 일관되게 구현한다.

대상 코드베이스: FinProof Agent (Next.js App Router 16 / React 19 / TS).
데이터 계층 규칙: `ReviewStore` 인터페이스 + `mock-review-store.ts` + `prisma-review-store.ts` +
`prisma/schema.prisma` 를 **항상 함께** 수정한다(자동 폴백 없음). 두 스토어 모두 동일 동작을 보장.

---

## 공통 용어
- 요청자 = `requester`, 심의자 = `reviewer`/`compliance_admin`.
- 결정(최종): `approved`(승인) / `change_requested`(수정요청) / `rejected`(반려) / `on_hold`(보류).
- 의견서 = `currentDraft`(+`currentDraftVersion`). 심의 버전 = 한 케이스 안의 심의 회차.

---

## 기능 1 + 2: 재업로드 → 재검토, 그리고 심의 "버전"

### 데이터 모델 (신규)
`ReviewCase`에 필드 추가:
- `currentVersion: number` (기본 1). 현재 진행 중인 심의 회차 번호.

신규 엔티티 `ReviewVersion` (한 케이스의 과거 심의 회차 스냅샷):
```
ReviewVersion {
  id: string
  reviewCaseId: string
  versionNumber: number          // 1,2,3...
  status: FinalReviewStatus      // 그 회차의 결정 (approved|change_requested|rejected|on_hold)
  reviewerComment?: string       // finalize 시 코멘트
  opinionDraft?: string          // 그 회차 currentDraft 스냅샷
  issuesSnapshot: ReviewIssue[]  // 그 회차 issues[] 스냅샷 (JSON)
  filesSnapshot: Array<{ id; name; fileType }>  // 그 회차 제출 파일 메타 스냅샷
  decidedByUserId: string
  decidedByName?: string
  decidedAt: string              // ISO
  createdAt: string
  // unique: (reviewCaseId, versionNumber)
}
```
Prisma 모델명 `ReviewVersion`, 테이블 `review_versions`, `@@unique([reviewCaseId, versionNumber])`,
`onDelete: Cascade`. JSON 컬럼은 기존 패턴(`Json`) 사용. enum은 기존 `SuggestedAction`/`ReviewStatus`
재사용 가능(status는 `ReviewStatus` 컬럼으로 두고 4값만 저장).

### 동작
1. **finalize 시 버전 스냅샷 기록(upsert)**: 심의자가 케이스를 최종 결정(`updateReviewStatus`)할 때,
   현재 `currentVersion` 번호로 `ReviewVersion`을 upsert 한다(같은 versionNumber면 갱신).
   스냅샷 내용 = 결정 status, reviewerComment, 현재 `currentDraft`, 현재 `issues[]`, 현재 파일 메타.
   → 즉 "결정이 내려진 회차"는 항상 버전 레코드로 남는다.
2. **요청자 재업로드(재검토 요청)**: 케이스 status ∈ {`change_requested`, `rejected`} 이고
   actor가 그 케이스의 소유 requester 일 때만 허용.
   - 새 파일 업로드(기존 multipart 업로드/분류/아카이브 확장 로직 재사용).
   - 라이브 케이스를 새 회차로 리셋: `files` 교체, `issues` 비움, `currentDraft`/`currentDraftVersion` 초기화,
     `highestRiskLevel` 재계산(없으면 info), `currentVersion += 1`, `status = "analysis_waiting"`,
     `analysisStartedAt/CompletedAt/finalDecisionAt` 클리어.
   - 직전 회차 스냅샷은 이미 finalize에서 기록되어 있으므로 보존됨.
   - 감사 이벤트 `review_case.revision_uploaded` 기록(versionNumber 포함).
   - 반환: 갱신된 케이스(+ analysisStartHref 유사 정보 가능).
3. **버전별 조회**: 과거 버전은 `ReviewVersion` 스냅샷을 읽고, 현재 진행 회차는 라이브 케이스를 읽는다.

### 스토어 메서드 (인터페이스 + mock + prisma 모두)
- `createReviewCaseRevision(scope, reviewCaseId, input): Promise<ReviewCase | undefined>`
  - input = 업로드된 분류 파일 목록 + (선택) 메타. 기존 `createReviewCaseFromUploadedFiles` 시그니처/타입을 참고해
    동일한 파일 표현을 받는다. 권한/상태 가드는 서비스 계층에서 우선 체크하되, 스토어도 소유/상태를 방어적으로 확인.
- `listReviewVersions(scope, reviewCaseId): Promise<ReviewVersion[]>` (versionNumber asc).
- finalize 경로(`updateReviewStatus`) 내부에서 버전 upsert 수행(별도 public 메서드 `recordReviewVersionSnapshot`로
  분리해도 좋음 — 두 스토어 동일하게).

### 서비스 / 라우트
- 서비스: `createReviewCaseRevision(context, caseId, files/meta)` — requester 전용 + 소유 + 상태 가드.
- 서비스: `listReviewVersions(context, caseId)`.
- 라우트: `POST /api/v1/review-cases/[caseId]/revisions` (multipart, 기존 생성 라우트 `route.ts`의
  `createFromMultipart` 로직 최대한 재사용/추출). `GET /api/v1/review-cases/[caseId]/versions`.

---

## 기능 3: AI 분석 실패 → 직접검토 + 재시도

### 상태 추가
`ReviewStatus`에 `analysis_failed` 추가(도메인 union + prisma enum + 라벨맵).
라벨: "분석 실패". prisma enum에 값 추가 → 마이그레이션 필요.

### 동작
- `failAnalysisJob` / `failStaleAnalysisJobs` 는 케이스 status를 **`analysis_failed`** 로 설정
  (기존 `analysis_waiting` 대신). 두 스토어 동일. 기존 테스트가 `analysis_waiting`을 기대하면 갱신.
- `availableActionsFor(role, "analysis_failed")` (reviewer/admin):
  `["start_analysis", "open_workbench", "view_audit"]`  // 재시도 + 직접검토 + 감사
- `startAnalysis` 시작 허용 상태에 `analysis_failed` 추가(현재 `submitted|analysis_waiting` 가드 → 셋째 값 추가).
- 직접검토(워크벤치) 진입 시 `analysis_failed` 케이스도 정상 로드(이슈 0건 가능).
- **수동 이슈 추가**: 신규 스토어 메서드 `createManualIssue(scope, caseId, input): Promise<ReviewIssue>`.
  - input: `{ issueType?, riskLevel, title, targetText?, description?, suggestedAction, suggestedCopy? }`.
  - 생성 이슈: `sourceAgents: ["manual"]`, `agentFindingId: undefined`, `status: "open"`,
    `targetBbox: [0,0,0,0]` 기본, `confidence` 생략. 케이스 `highestRiskLevel` 재계산.
  - 인터페이스 + 두 스토어 구현. 라우트 `POST /api/v1/review-cases/[caseId]/issues` (reviewer 전용).
- finalize는 이미 소스 상태 검증이 느슨하므로 `analysis_failed`/직접검토 상태에서도 동작.
  단, UI(canMutate/availableActions) 게이팅에서 직접검토 결정이 가능해야 함.

### UI
- 큐(`ReviewQueue`/`QueueTable`): `analysis_failed` 행에 "재시도"(start_analysis) + "직접검토"(open_workbench) 노출.
- 폴링 로직(`ReviewQueue` analysis status `failed` 처리): 케이스를 `analysis_failed`로 반영하고
  실패 메시지 + 직접검토 진입 동선을 보여줌.
- 워크벤치(`ReviewDetailWorkspace`): status가 `analysis_failed`면 상단 배너
  "AI 분석 실패 — 직접검토 모드" + 실패 사유(최근 job errorMessage) + "AI 분석 재시도" 버튼 표시.
- "이슈 직접 추가" 버튼(IssueList 또는 워크벤치): 작은 폼(제목/위험도/지적 텍스트/설명/제안조치) → POST → 새로고침.

---

## 기능 4: 심의필 (승인 증명서) — 자유 서술 + 자동 메타데이터

### 데이터 모델 (신규)
신규 엔티티 `ReviewCertificate` (케이스당 1개):
```
ReviewCertificate {
  id: string
  reviewCaseId: string           // unique
  certificateNumber: string      // 자동: FP-{승인연도}-{caseId 후미 6자 대문자}
  body: string                   // 심의자 자유 서술 (심의 의견/부가 조건)
  metadata: {                    // 발급 시점 스냅샷 (JSON)
    title; productType; affiliateName; reviewerName; approvedAt
  }
  issuedByUserId: string
  issuedByName?: string
  issuedAt: string               // ISO
  updatedAt: string
  createdAt: string
}
```
Prisma 모델 `ReviewCertificate`, 테이블 `review_certificates`, `reviewCaseId @unique`,
`onDelete: Cascade`. 마이그레이션 필요.

### 동작
- 발급/수정: status == `approved` 인 케이스에 대해서만. reviewer/admin 전용.
  - `certificateNumber`는 최초 발급 시 1회 생성(고정). 재저장 시 body/metadata/updatedAt만 갱신.
- 조회: reviewer/admin 항상. requester는 **본인 소유 + 케이스 approved** 일 때만 GET 허용.

### 스토어 메서드 (인터페이스 + 두 스토어)
- `issueReviewCertificate(scope, caseId, { body }): Promise<ReviewCertificate>` (upsert)
- `getReviewCertificate(scope, caseId): Promise<ReviewCertificate | undefined>`

### 서비스 / 라우트
- 서비스: `issueReviewCertificate(context, caseId, input)` (reviewer 전용 + approved 가드),
  `getReviewCertificate(context, caseId)` (reviewer 전체 / requester 소유+approved).
- 라우트: `POST /api/v1/review-cases/[caseId]/certificate`, `GET /api/v1/review-cases/[caseId]/certificate`.

### UI
- 심의자: 심의 이력 탭(`ReviewQueue` scope=history)의 **승인(approved)** 행에 "심의필" 액션 →
  작성/발급 UI(모달 또는 상세페이지 패널). 자동 메타데이터는 읽기전용 표시 + 본문 textarea + 발급 버튼.
- 요청자: `RequesterRequestCenter` 승인 케이스에 "심의필 보기" 확장(기존 "반려사유" 패턴 재사용) →
  GET 후 자동 헤더(번호/케이스/상품/승인일/심의자) + 본문 렌더.

---

## 마이그레이션
`prisma/migrations/<timestamp>_revision_versions_direct_review_certificate/migration.sql` 신규 1개:
- `ReviewStatus` enum에 `analysis_failed` 추가 (`ALTER TYPE "ReviewStatus" ADD VALUE 'analysis_failed';`).
- `review_cases.current_version INT NOT NULL DEFAULT 1` 추가.
- `review_versions`, `review_certificates` 테이블 + 인덱스/FK 생성.
타임스탬프는 기존 최신(2026-06-07...)보다 뒤. `npm run db:generate`로 클라이언트 재생성하여 TS 컴파일 보장.
로컬 DB가 없으면 SQL 수기 작성(기존 마이그레이션 스타일 준수) + `prisma validate` + `prisma generate` 통과 확인.

## 검증 (각 단계 공통)
- `npm run db:generate` (스키마 변경 후) → `npm run lint` (max-warnings=0) → `npm run build`(필요시) → `npm test`.
- 기본 스토어는 mock 이므로 mock 경로 테스트가 핵심. 콜로케이션 테스트(`*.test.ts`) 추가/갱신.
- 두 스토어가 인터페이스를 모두 만족하는지 타입 체크로 보장.
