# API Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-aware review list actions plus analysis status and audit event API endpoints.

**Architecture:** Keep route handlers thin. Add contract shaping in `review-service.ts`, reuse existing mock/prisma store methods, and extend route tests before production code.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Vitest.

---

### Task 1: Add Failing Contract Tests

**Files:**

- Modify: `src/api/review-api-routes.test.ts`

- [x] Add imports for `GET /analysis/status` and `GET /audit-events`.
- [x] Assert requester list does not include `start_analysis`.
- [x] Assert reviewer list includes `start_analysis`.
- [x] Assert analysis status is `not_started` before analysis.
- [x] Assert analysis status is `completed` after analysis.
- [x] Assert audit events include `analysis.start`.
- [x] Run `npm run test -- src/api/review-api-routes.test.ts` and confirm failure because routes/service helpers do not exist yet.

### Task 2: Implement Service Contract Helpers

**Files:**

- Modify: `src/server/reviews/review-service.ts`

- [x] Add `ReviewAction` and `AnalysisStatusResponse` types.
- [x] Add `availableActionsFor(role, status)`.
- [x] Change `listReviewSummaries` to return summaries with `availableActions`.
- [x] Add `getAnalysisStatus(context, caseId)`.
- [x] Keep store contracts unchanged.

### Task 3: Add Routes

**Files:**

- Create: `src/app/api/v1/review-cases/[caseId]/analysis/status/route.ts`
- Create: `src/app/api/v1/review-cases/[caseId]/audit-events/route.ts`

- [x] Implement analysis status route with `404` for missing case.
- [x] Implement audit events route with `404` for missing case.
- [x] Use `requestContext(request)` in both routes.

### Task 4: Verify

**Files:**

- Modify only if verification exposes necessary fixes.

- [x] Run focused route test.
- [x] Run full `npm run test`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run build`.

## Self-Review

- Scope is API-only.
- Follow-up DB smoke and UI connection were implemented after the API contract slice.
- No schema or Prisma migration is needed.
