# API Contract Hardening Design

## Goal

Expose the backend state added in the persistence/RBAC slice through stable API contracts that the review queue UI, Prisma smoke tests, and audit UI can consume next.

## Scope

This slice adds:

- Role-aware `availableActions` on `GET /api/v1/review-cases`.
- `GET /api/v1/review-cases/{caseId}/analysis/status`.
- `GET /api/v1/review-cases/{caseId}/audit-events`.

This slice started as API-only. Follow-up implementation added local Postgres orchestration,
Prisma API smoke, and UI rendering for the exposed contracts.

## API Shape

### Review List

`GET /api/v1/review-cases` keeps the existing `{ reviewCases }` response shape. Each item gets an `availableActions` array.

Rules:

- `analysis_waiting` and role `reviewer` or `compliance_admin`: `["start_analysis"]`
- `analysis_complete`: `["open_workbench", "view_audit"]`
- final states `approved`, `change_requested`, `rejected`, `on_hold`: `["view_audit"]`
- all other cases: `[]`

Requester does not receive `start_analysis`.

### Analysis Status

`GET /api/v1/review-cases/{caseId}/analysis/status`

- If the case does not exist: `404`.
- If latest analysis job exists: return `{ reviewCaseId, status, progress, currentStep, jobId, queuedAt, startedAt, completedAt, errorMessage }`.
- If no job exists and the case exists: return `{ reviewCaseId, status: "not_started", progress: 0, currentStep: "waiting_for_reviewer", jobId: null }`.

### Audit Events

`GET /api/v1/review-cases/{caseId}/audit-events`

- If the case does not exist: `404`.
- Returns `{ auditEvents }` filtered to `targetType = "review_case"` and `targetId = caseId`, latest first.
- Tenant scoping follows `RequestContext`.

## Architecture

Add response shaping to `review-service.ts`, because route handlers should remain thin and because `availableActions` depends on both role and review status. Store interfaces already expose `getLatestAnalysisJob` and `listAuditEvents`, so no schema change is needed.

Add route handlers for status and audit. Keep all existing route responses stable and additive.

## Testing

Extend `src/api/review-api-routes.test.ts` first:

- requester list excludes `start_analysis`.
- reviewer list includes `start_analysis` for `analysis_waiting`.
- analysis status is `not_started` before analysis and `completed` after analysis.
- audit endpoint returns `analysis.start` after reviewer starts analysis.
- missing case returns `404` for new endpoints.

## Follow-Up Implementation

1. Prisma actual DB verification: `compose.yaml`, existing migration/seed commands, and `npm run db:smoke`.
2. UI connection: review queue consumes `availableActions`; workbench loads analysis status and audit events.
