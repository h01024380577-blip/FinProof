# Frontend Redesign: Stitch-Inspired UX/IA Refinement

- **Date:** 2026-05-26
- **Author:** jiwon (with Nexus team subagents)
- **Status:** Approved for implementation
- **Reference designs:** Stitch project `9779744429229908795`
  - Screen `9d7ef4e420b242d1bb36400157e04b80` — Review Queue (Enterprise)
  - Screen `4f11e879cd24469e96ced8e75afca1f2` — Review Workbench (Enterprise)
  - Screen `eae38365e16f4e8d8441b315cf8fb48c` — New Review Request (Enterprise)

## Goal

Refine the existing FinProof Agent frontend to align with the Stitch enterprise reference designs, prioritizing user-comfortable UX over literal visual reproduction. Scope is **UX/IA refinement + visual polish**: keep API contracts stable, restructure components only where it improves clarity, layer in a small shared UI primitive set so the three primary screens share consistent metrics, tabs, steppers, dropzones, and filters.

## Non-Goals

- No backend API changes (route handlers, persistence, auth modes stay).
- No global state library introduction (React hooks + existing `RoleContext` are sufficient).
- No new analytics, telemetry, or feature-flag wiring.
- Mobile/responsive layouts beyond the existing desktop-first breakpoints (sized to current `1280px+` workspace).

## Constraints

- Next.js 16 App Router + React 19 + TypeScript.
- Korean copy preserved.
- Existing `vitest` tests must continue to pass; selector updates allowed where markup legitimately changed.
- Lint (`npm run lint --max-warnings=0`), `npm run test`, `npm run build` must remain green at every spec boundary.
- Existing CSS class names that anchor tests (`.app-shell`, `.review-queue`, `.detail`, `.intake-flow`, badge classes) stay as compatibility anchors even if internal structure changes.

## Architecture

### Shared Design Tokens (`src/app/globals.css`)

Add to `:root` (existing tokens preserved for compatibility):

- **Gray scale 6 steps:** `--gray-50` through `--gray-900`. Existing `--line`, `--muted`, `--text-soft` aliased to these.
- **Tone colors (semantic):** `--tone-info`, `--tone-caution`, `--tone-high`, `--tone-reject`, `--tone-verified`, `--tone-in-progress` plus matching `-bg` and `-border` variants. Existing `--risk-*` tokens kept, aliased.
- **Spacing scale:** `--space-1` (4px) through `--space-8` (48px), 4px grid.
- **Radius:** `--radius-sm` (4px), `--radius-md` (8px), `--radius-lg` (12px).
- **Shadows:** `--shadow-card`, `--shadow-popover` (existing), `--shadow-elevated`.
- **Typography:** `--font-size-xs/sm/base/lg/xl/2xl`, `--font-weight-normal/medium/semibold/bold`, `--line-height-tight/normal/relaxed`.

### Shared UI Primitives (`src/components/ui/`)

New folder with primitive components, each isolated and independently testable.

- **`KpiCard`** — `{ label, value, tone, hint?, onClick? }`. Renders a metric tile with large numeric, tonal accent, optional click-to-filter callback. Used by Review Queue.
- **`Tabs`** — accessible `role="tablist"` container with `Tab` and `TabPanel` children. Supports controlled (URL-synced) and uncontrolled modes. Used by Workbench right pane + bottom drawer.
- **`Stepper`** — `{ steps: [{ key, label, status: 'pending' | 'active' | 'done' }] }`. Ordered list with state-driven visual treatment. Used by New Review Request.
- **`DropZone`** — `{ accept, multiple, onFilesSelected, files, onRemoveFile, helperText, error? }`. Renders drag-over state, lists selected files with remove buttons. Used by New Review Request.
- **`FilterBar`** — composes search input + select chips + reset button. Generic enough to be reused later; for now consumed by Review Queue.
- **`ui/index.ts`** — barrel export.

Each primitive ships with a vitest test (`*.test.tsx`). 80%+ branch coverage target.

### Screen-Specific Modules

**`src/components/queue/`** — extracted from `ReviewQueue.tsx`:
- `QueueMetrics.tsx` — uses `KpiCard`, accepts review list + filter setter for click-to-filter.
- `QueueFilters.tsx` — uses `FilterBar`, owns search/status/risk/product state callbacks.
- `QueueTable.tsx` — table with reordered columns, full-row click navigation, status-aware action column.

**`src/components/workbench/`** — extracted from `ReviewDetailWorkspace.tsx`:
- `WorkbenchHeader.tsx` — sticky case header + action group.
- `IssueList.tsx` — left column with risk chip filter and issue cards.
- `CreativeViewer.tsx` — middle pane with zoom controls and bbox highlights (extends existing inline component).
- `IssueDetailTabs.tsx` — right pane with three tabs (체크리스트 / 근거 자료 / 의견서), URL-synced via `?tab=`.
- `WorkbenchDrawer.tsx` — bottom collapsible drawer with chat / draft / audit / files tabs (existing four).

**`src/components/intake/`** — extracted from `SamplePackageSelector.tsx`:
- `IntakeStepper.tsx` — uses `Stepper`, derives step states from form/upload/result props.
- `IntakeMetaForm.tsx` — left form panel.
- `IntakeUploadZone.tsx` — uses `DropZone`, owns file list + validation feedback.
- `IntakeClassificationPanel.tsx` — sticky right panel: auto-classification result.
- `IntakeRequiredMaterialsPanel.tsx` — sticky right panel: missing materials.

The original entry components (`ReviewQueue.tsx`, `ReviewDetailWorkspace.tsx`, `SamplePackageSelector.tsx`) become thin compositions of these modules. Public exports and route imports stay unchanged.

## Screen-Level Changes

### Review Queue (`/reviews`)

- **KPI strip → KPI cards.** Four cards with large numeric, tonal accent. "반려 권고" and "마감 임박" cards are clickable, applying the corresponding filter.
- **Search bar promoted** to its own row, full-width within the toolbar zone.
- **Filters as chips** (status / risk / product) with active visual state. Reset button when any filter is active.
- **Column reorder:** ID (mono, secondary) → 제목 (bold, 2-line clamp) → 상품군 → 요청 부서 → 상태 → 위험도 → 마감일 → 담당자 → 작업. All current columns retained; only visual hierarchy adjusted (title bold, ID monospace/muted, "최근 활동" merged into a single deadline-and-activity cell to reduce row width pressure).
- **Full-row click** navigates to the workbench when the case is openable; analysis-waiting rows show inline "AI 분석 시작" primary button.
- **Empty/loading/error states** explicit per Error States section below.
- **Keyboard:** `/` focuses search; row arrow-keys + Enter navigate.

### Review Workbench (`/reviews/[id]`)

- **Compact header.** ID, title, status badge, top-risk badge, assignee, deadline on one line. Action group (`보류`, `반려`, `수정 요청`, `초안 생성`, `리포트 다운로드`) stays right-aligned and sticky on vertical scroll.
- **Three-column grid:**
  1. **Issue list** (280px) — risk chip filter row, issue cards with left risk-color border, two-line title, target-text preview, issue index.
  2. **Creative viewer** — flex, larger than today. Existing zoom/page controls and bbox highlights retained; bbox click syncs the issue selection.
  3. **Issue detail (tabbed)** — `체크리스트` (suggested-copy + summary), `근거 자료` (evidence cards), `의견서` (reviewer risk + comment + final action + finalize CTA). Active tab persisted in `?tab=` URL param.
- **Action label clarification.** Header `보류/반려/수정 요청` buttons relabel to "이슈 추천 조치" group header so they read as per-issue suggestions, not case-level finalization.
- **Bottom drawer** keeps its four tabs (`근거 채팅`, `의견 초안`, `감사 로그`, `파일`) but becomes collapsible (toggle in drawer header). Default state: expanded for compliance_admin / reviewer roles, collapsed for requester role.
- **Bidirectional issue ↔ bbox highlight** with stronger visual treatment when selected.

### New Review Request (`/reviews/new`)

- **Stepper accuracy.** Step states derive from real progress:
  1. 요청 메타 — `active` when any required field empty, `done` once all required filled.
  2. 자료 업로드 — `active` once on step 2 and no files, `done` once files added.
  3. 자동 분류 확인 — `active` after upload submission begins, `done` on server response.
  4. 제출 완료 — `done` once `uploadResult` exists.
- **Two-column form grid** with wide fields (title, memo) spanning. Required indicators (`*`) on label.
- **Drop zone enlarged** with drag-over highlight, file list inline with remove buttons, per-file progress on submit.
- **Sticky right rail** for classification + missing-materials panels.
- **Sticky footer CTA bar** with `심의 요청 제출` plus inline validation message in the same row.
- **Post-submit state** keeps the page mounted with a success card + two CTAs (`심의 큐로 이동`, `다른 요청 작성`).

## Data Flow

- All `/api/v1/review-cases/*` endpoints unchanged.
- `RoleContext` (`activeRole`) continues to gate mutating actions via `canMutateReview` helper. Header values preserved.
- Workbench right-pane tab state synchronized to URL via `useSearchParams` + `router.replace` (no full navigation).
- Queue KPI counts derived client-side from already-fetched list (current behavior); no new endpoints needed.
- New optional `daysToDeadline` field on `ReviewSummary` (derivable from `plannedPublishDate`) — computed in the existing summarizer, used for "마감 임박" sort/badge. Backward compatible.

## Error / Loading / Empty States

| Surface | Loading | Empty | Permission denied | API failure |
|---|---|---|---|---|
| Queue list | 5 skeleton rows | "아직 심의 요청 없음" + CTA to `/reviews/new` | Action buttons disabled with tooltip | Inline alert above table with retry button |
| Workbench panels | Per-panel skeleton | "선택 가능한 이슈 없음" + analysis notice | Mutate buttons disabled with tooltip | Inline alert in affected panel only — siblings keep working |
| Workbench drawer (support data) | Spinner in analysis-status section | "감사 이벤트 없음" | n/a | `supportDataError` text — drawer remains usable for other tabs |
| Intake form | Submit button shows "제출 중" | n/a | n/a | `form-error` line above submit; form remains editable |

Add a top-level `ErrorBoundary` in `AppShell` to contain unhandled render errors and present a recoverable fallback.

## Accessibility

- All new primitives use semantic roles: `tablist`/`tab`/`tabpanel`, `progressbar` semantics for stepper aria, `region` for KPI strip with `aria-label`.
- Focus-visible outline preserved from existing `:focus-visible` rule.
- Keyboard navigation: queue rows reachable via Tab, arrow-key navigation within table body, Enter to open.
- Color tone alone is never the only indicator — risk badges combine icon + label + color.

## Testing Strategy

**Preserved**
- `AppShell.test.tsx`, `ReviewQueue.test.tsx`, `ReviewDetailWorkspace.test.tsx`, `SamplePackageSelector.test.tsx`, `RoleSwitcher.test.tsx` — kept passing. Selector updates allowed where markup legitimately changed.

**Added**
- `ui/KpiCard.test.tsx`, `ui/Tabs.test.tsx`, `ui/Stepper.test.tsx`, `ui/DropZone.test.tsx`, `ui/FilterBar.test.tsx` — unit tests for each primitive.
- Workbench: `?tab=` URL sync test; bbox ↔ issue selection sync test.
- Queue: KPI card click applies filter test; full-row navigation test.
- Intake: stepper state progression test.

**Quality gates per spec PR**
- `npm run lint`, `npm run test`, `npm run build` all green.
- New components ≥ 80% branch coverage in vitest.

## File Layout

```
src/
  components/
    ui/
      KpiCard.tsx + .test.tsx
      Tabs.tsx + .test.tsx
      Stepper.tsx + .test.tsx
      DropZone.tsx + .test.tsx
      FilterBar.tsx + .test.tsx
      index.ts
    queue/
      QueueMetrics.tsx
      QueueFilters.tsx
      QueueTable.tsx
    workbench/
      WorkbenchHeader.tsx
      IssueList.tsx
      CreativeViewer.tsx
      IssueDetailTabs.tsx
      WorkbenchDrawer.tsx
    intake/
      IntakeStepper.tsx
      IntakeMetaForm.tsx
      IntakeUploadZone.tsx
      IntakeClassificationPanel.tsx
      IntakeRequiredMaterialsPanel.tsx
    AppShell.tsx                (token-aligned, IA unchanged, adds ErrorBoundary)
    ReviewQueue.tsx             (thin composition of queue/*)
    ReviewDetailWorkspace.tsx   (thin composition of workbench/*)
    SamplePackageSelector.tsx   (thin composition of intake/*)
  app/
    globals.css                 (additive token block + targeted class updates)
```

## Spec Decomposition for Nexus Team

Four specs. Spec 0 must complete before Spec 1/2/3, which run in parallel.

### Spec 0 — Design Tokens + Shared UI Primitives
- Add token block to `globals.css` (additive, no breaking changes).
- Create `src/components/ui/` with `KpiCard`, `Tabs`, `Stepper`, `DropZone`, `FilterBar` + tests + barrel export.
- Update `AppShell.tsx` to wrap children with `ErrorBoundary` (new file `src/components/ErrorBoundary.tsx`).
- No screen-level changes yet.
- Quality gate: lint + test + build green; existing snapshots/selectors still pass.

### Spec 1 — Review Queue Refinement
- Depends on: Spec 0.
- Add `src/components/queue/{QueueMetrics, QueueFilters, QueueTable}`.
- Refactor `ReviewQueue.tsx` into composition of those.
- Implement KPI cards (clickable for filter), filter chips, column reorder, full-row navigation, keyboard shortcuts.
- Update `ReviewQueue.test.tsx` selectors as needed; add tests for KPI-click-to-filter and row navigation.
- Quality gate: lint + test + build green.

### Spec 2 — Workbench Refinement
- Depends on: Spec 0.
- Add `src/components/workbench/{WorkbenchHeader, IssueList, CreativeViewer, IssueDetailTabs, WorkbenchDrawer}`.
- Refactor `ReviewDetailWorkspace.tsx` into composition of those.
- Implement compact header, three-column grid, tabbed right pane (URL-synced via `?tab=`), collapsible bottom drawer, stronger issue ↔ bbox bidirectional highlight.
- Clarify the header action group label ("이슈 추천 조치").
- Update `ReviewDetailWorkspace.test.tsx`; add tests for tab URL sync and bbox↔issue sync.
- Quality gate: lint + test + build green.

### Spec 3 — New Review Request Refinement
- Depends on: Spec 0.
- Add `src/components/intake/{IntakeStepper, IntakeMetaForm, IntakeUploadZone, IntakeClassificationPanel, IntakeRequiredMaterialsPanel}`.
- Refactor `SamplePackageSelector.tsx` into composition of those.
- Implement accurate stepper state derivation, enlarged drop zone with file list, sticky CTA footer, post-submit success state with dual CTAs.
- Update `SamplePackageSelector.test.tsx`; add stepper progression test.
- Quality gate: lint + test + build green.

## Open Risks

- **Test selector churn.** Splitting screens into sub-components forces selector updates. Mitigated by preserving outer class names (`.review-queue`, `.detail`, `.intake-flow`) and badge classes as compatibility anchors.
- **Stepper inaccuracy edge case.** If a user resubmits after editing meta, the step "자동 분류 확인" must reset from `done` back to `active` on next submit — covered in test plan.
- **URL-synced tab + role switch.** Switching `activeRole` while on the workbench should preserve the active tab; only mutate-button availability changes.

## Sign-Off

When all four specs land and the dev server visually matches the agreed UX, the work is complete. Final deliverables:
- Dev server at `http://localhost:3000` passing visual verification on `/reviews`, `/reviews/[id]`, `/reviews/new`.
- All quality gates green.
- A short summary report to the user with screenshots/observations of each refined screen.
