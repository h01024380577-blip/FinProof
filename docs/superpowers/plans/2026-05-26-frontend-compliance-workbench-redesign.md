# FinProof Frontend Compliance Workbench Redesign

Date: 2026-05-26

## Goal

Shift the frontend from the current demo-style MVP shell into a dense compliance operations console based on the attached reference screens.

Backend hardening is explicitly out of scope for this plan. The first frontend pass should preserve existing API contracts and behaviors while changing the product surface to:

- Review queue as the default work surface.
- Three-pane review workbench for AI issue triage and reviewer decisions.
- New review request intake with metadata, upload, auto-classification, and missing-material checks.
- Flat enterprise visual language: white/gray surfaces, navy accents, thin borders, compact typography, minimal rounding.

## Constraints

- Keep the existing Next.js App Router structure.
- Keep current mock/API-backed behavior intact.
- Use existing component boundaries unless a small extraction reduces layout complexity.
- Use lucide icons for action and navigation affordances.
- Avoid marketing/landing-page patterns.
- Maintain accessible names used by the current tests where practical; update tests when visible product language intentionally changes.

## Implementation Steps

### 1. Plan And Test Baseline

Files:

- `docs/superpowers/plans/2026-05-26-frontend-compliance-workbench-redesign.md`
- `src/components/AppShell.test.tsx`
- `src/components/ReviewQueue.test.tsx`
- `src/components/ReviewDetailWorkspace.test.tsx`
- `src/components/SamplePackageSelector.test.tsx`

Actions:

1. Add this plan.
2. Update tests to pin the new visible shell language:
   - `FinProof`
   - `JB금융그룹 / 광주은행 / 소비자보호부`
   - `Compliance workbench`
   - right-side topbar controls.
3. Update queue tests to cover the new KPI labels and table-oriented controls.
4. Update intake tests to cover the new stepper and required-material side panels.

Verification:

- Run targeted component tests before implementation and confirm the expected failures.

### 2. App Shell And Design Tokens

Files:

- `src/components/AppShell.tsx`
- `src/app/globals.css`

Actions:

1. Replace the demo MVP shell with the reference-style fixed sidebar and thin topbar.
2. Add breadcrumb rendering for:
   - `/reviews`: `FinProof Agent > 심의 큐`
   - `/reviews/new`: `심의 큐 > 신규 심의 요청`
   - `/reviews/[id]`: `심의 큐 > 심의 상세`
3. Keep role switching available but visually subordinate to the avatar/control area.
4. Normalize tokens:
   - navy primary
   - gray borders
   - off-white workspace background
   - 2-4px radii for operational controls
   - compact spacing.

Verification:

- `npm run test -- src/components/AppShell.test.tsx`

### 3. Review Queue

Files:

- `src/components/ReviewQueue.tsx`
- `src/app/globals.css`
- `src/components/ReviewQueue.test.tsx`

Actions:

1. Rework header copy to `심의 큐` with operational subtitle.
2. Add KPI cards:
   - `분석 대기`
   - `검토 중`
   - `반려 권고`
   - `마감 임박`
3. Add compact search and filter controls.
4. Convert the queue list to a dense bordered table with reference columns:
   - 심의 ID
   - 제목
   - 상품군
   - 요청 부서
   - 상태
   - 최고 위험도
   - 최근 활동
   - 담당자
   - 마감일
   - 작업
5. Preserve `AI 분석 시작` and workbench open behavior.

Verification:

- `npm run test -- src/components/ReviewQueue.test.tsx`

### 4. Review Detail Workbench

Files:

- `src/components/ReviewDetailWorkspace.tsx`
- `src/app/globals.css`
- `src/components/ReviewDetailWorkspace.test.tsx`

Actions:

1. Restyle the detail header with breadcrumb-like metadata, status/risk chips, and reviewer actions.
2. Reframe the main workspace as:
   - left issue list
   - center document viewer
   - right issue detail/evidence panel
3. Restyle the bottom drawer as tabbed evidence chat/draft/audit/files workspace.
4. Keep RAG chat, draft generation, audit, and finalization behaviors intact.

Verification:

- `npm run test -- src/components/ReviewDetailWorkspace.test.tsx`

### 5. New Review Request

Files:

- `src/components/SamplePackageSelector.tsx`
- `src/app/globals.css`
- `src/components/SamplePackageSelector.test.tsx`

Actions:

1. Replace the hero-like intro with a form-first intake page.
2. Show the four-step horizontal stepper at the top.
3. Build a two-column upper layout:
   - left request metadata form/sample selector
   - right auto-classification and missing-material panels
4. Place the upload dropzone below the metadata panel.
5. Keep sample package submission and real upload behavior intact.

Verification:

- `npm run test -- src/components/SamplePackageSelector.test.tsx`

### 6. Full Verification

Commands:

1. `npm run test`
2. `npm run format`
3. `npm run lint`
4. `npm run build`
5. Start local dev server and verify:
   - `/reviews`
   - `/reviews/new`
   - selected review workbench from queue
   - desktop and mobile viewport screenshots.

Done when:

- Tests pass.
- Build passes.
- Browser verification shows non-overlapping shell, table, workbench panes, and intake form.
