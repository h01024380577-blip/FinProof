# Workbench Role Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve active role context through review workbench API calls and enforce reviewer-only draft mutations.

**Architecture:** Keep role propagation local to `ReviewDetailWorkspace` helpers. Keep server authorization centralized in `review-service.ts` and route-level error shaping in route handlers.

**Tech Stack:** Next.js App Router route handlers, React, TypeScript, Vitest, Testing Library.

---

### Task 1: Add Failing API RBAC Tests

**Files:**

- Modify: `src/api/review-api-routes.test.ts`

- [x] Assert requester `POST /draft` returns `403`.
- [x] Assert requester `PATCH /draft` returns `403`.
- [x] Run `npm run test -- src/api/review-api-routes.test.ts` and confirm failure because draft service path is not role-gated yet.

### Task 2: Add Failing Workbench Role Tests

**Files:**

- Modify: `src/components/ReviewDetailWorkspace.test.tsx`

- [x] Wrap workbench render in `RoleProvider initialRole="reviewer"` and assert support-data fetches include `x-finproof-role: reviewer`.
- [x] Render with `RoleProvider initialRole="requester"` and assert reviewer-only mutation controls are disabled.
- [x] Run `npm run test -- src/components/ReviewDetailWorkspace.test.tsx` and confirm failure before production code.

### Task 3: Implement Server RBAC For Drafts

**Files:**

- Modify: `src/server/reviews/review-service.ts`
- Modify: `src/app/api/v1/review-cases/[caseId]/draft/route.ts`

- [x] Add `requireRole(context, ["reviewer", "compliance_admin"], "save opinion draft")` to `saveOpinionDraft`.
- [x] Catch route errors with `jsonForbidden(error)` in draft `POST` and `PATCH`.

### Task 4: Implement Client Role Propagation

**Files:**

- Modify: `src/components/ReviewDetailWorkspace.tsx`

- [x] Read `useRoleContext()` and default to `reviewer` if absent.
- [x] Add helpers for role-only headers and JSON headers.
- [x] Send role headers on support-data, chat, draft, issue decision, finalize, and report requests.
- [x] Disable reviewer-only mutation controls for requester.

### Task 5: Verify

**Files:**

- Modify only if verification exposes necessary fixes.

- [x] Run focused API and component tests.
- [x] Run full `npm run test`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run build`.
