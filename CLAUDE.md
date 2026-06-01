# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

FinProof Agent is a Next.js App Router (v16) + React 19 + TypeScript app for evidence-based financial advertising review. Reviewers upload promotional packages, OCR + RAG agents analyze them against approved knowledge documents, and the workbench surfaces issues with evidence for a final approve / change-request / reject decision.

## Commands

```bash
npm run dev         # Next dev (Turbopack)
npm run build       # Production build
npm run start       # Run built app

npm run test                       # Vitest (jsdom), runs once
npm run test:watch                 # Watch mode
npx vitest run path/to/file.test.ts            # Single file
npx vitest run -t "name of test"               # By test name

npm run lint        # eslint --max-warnings=0  (CI fails on warnings)
npm run format      # Prettier check
npm run format:write
```

Prisma / DB (only when `FINPROOF_REVIEW_STORE=prisma`):

```bash
docker compose up -d postgres   # local pgvector/pg17
npm run db:generate             # prisma generate -> src/generated/prisma
npm run db:migrate -- --name <n>
npm run db:deploy               # CI / prod (uses DIRECT_URL)
npm run db:seed
npm run db:smoke                # tsx scripts/prisma-api-smoke.ts
```

Ops scripts (all `tsx scripts/*.ts`, idempotent plan/write/apply pattern):

```bash
npm run ops:readiness          # check-backend-readiness.ts
npm run ops:analysis:worker    # long-running analysis worker (queued mode)
npm run ops:ec2:plan|:write    # render systemd units + deploy script under ops/ec2
npm run ops:ci:plan|:write     # render .github/workflows
npm run ops:s3:plan|:apply     # provision review-artifact S3 bucket
```

## High-level architecture

Three layers, all under `src/`:

- **`src/app/`** — Next.js App Router. UI routes (`dashboard`, `reviews`, `reviews/[id]`, `reviews/new`, `knowledge-documents`) plus the full HTTP API under `src/app/api/v1/**`. Route handlers are thin: they parse the request, build a `ReviewStoreScope` from `request-context`, then call into `src/server/reviews/review-service.ts` or directly into the store.
- **`src/domain/`** — Framework-free types (`types.ts`) and pure logic (`reviews`, `intake`, `chat`, `reports`, `upload-policy`). Safe to import from both client components and server code.
- **`src/server/`** — All side-effecting code. Imported only from server components, API routes, scripts, and tests.

### The ReviewStore abstraction (most important)

`src/server/reviews/review-store.ts` defines the `ReviewStore` interface — the single seam between UI/API and persistence. Two implementations:

- `mock-review-store.ts` — in-memory; default when `FINPROOF_REVIEW_STORE` ≠ `prisma`. Powers the deterministic demo path.
- `prisma-review-store.ts` — Postgres + pgvector via the generated Prisma client in `src/generated/prisma`. Selected with `FINPROOF_REVIEW_STORE=prisma`.

`src/server/reviews/index.ts:getReviewStore()` memoizes the chosen store on a `globalThis` symbol. Tests call `resetDefaultReviewStoreForTests()` to swap implementations. **When adding methods, add them to both stores and the interface together** — there's no auto-fallthrough.

Every store call takes a `ReviewStoreScope { tenantId, actorUserId, actorRole, ipAddress? }` so audit events and RBAC checks are uniform. Build it via `src/server/auth/request-context.ts` — never construct it ad-hoc in routes.

### Auth modes

`FINPROOF_AUTH_MODE=demo` (default) reads identity from request headers / env defaults (`FINPROOF_DEFAULT_*`). `=jwt` validates bearer tokens via JWKS (`jose`) — prefer `FINPROOF_AUTH_JWKS_URL` + `FINPROOF_AUTH_JWT_ISSUER` + `FINPROOF_AUTH_JWT_AUDIENCE`; `FINPROOF_AUTH_JWT_SECRET` is an HS256 fallback only. RBAC tables live in `src/server/auth/rbac.ts`; the three roles are `requester`, `reviewer`, `compliance_admin`.

### Analysis pipeline

`src/server/analysis/review-analysis-pipeline.ts` orchestrates: **OCR → embedding → RAG retrieval → optional rerank → sub-agent findings → issue generation**. Each stage is a pluggable provider chosen by `provider-config.ts` from `FINPROOF_*_PROVIDER` env vars:

- OCR: `deterministic` | `gemini` | `http`
- Embedding: `deterministic` | `openai`
- RAG: `deterministic` | `postgres` (pgvector via Prisma store)
- Rerank: `deterministic` | `cohere`
- Model router: `deterministic` | `router` (OpenAI text + Gemini multimodal, tiers in `src/server/ai/model-router.ts`)

Execution mode is gated by `FINPROOF_ANALYSIS_EXECUTION_MODE`:
- `inline` — analysis runs synchronously inside the request that hit `POST /api/v1/review-cases/:caseId/analysis/start`.
- `queued` — request only enqueues; `scripts/run-analysis-worker.ts` (run via `npm run ops:analysis:worker`) claims jobs with `claimNextAnalysisJob` and completes them out-of-band. Production EC2 deploys this as a separate `systemd` unit.

Sub-agents (`review-subagents.ts`) split domain compliance checks; the compliance-lead aggregates findings into `ReviewIssue`s with `Evidence` chunks.

### Storage adapter

`src/server/storage/index.ts:getReviewStorageAdapter()` returns `local-metadata` (writes to `FINPROOF_LOCAL_UPLOAD_DIR`) or `s3` (`@aws-sdk/client-s3`, bucket from `FINPROOF_S3_BUCKET`). Uploaded ZIP packages are expanded via `archive-extraction.ts` with path-traversal protection. `upload-security.ts` enforces the optional scanner gateway (`FINPROOF_UPLOAD_SCAN_PROVIDER=http`).

### Knowledge documents (RAG corpus)

`src/server/knowledge/knowledge-ingestion.ts` chunks an approved document, embeds chunks via the configured embedding provider, and writes them via `replaceKnowledgeDocumentChunks` on the store. Only **approved** documents are searchable through `searchKnowledgeEvidence`; unapproving via the API drops them from retrieval. Case-history evidence (prior approved cases) is retrieved through the separate `searchCaseHistoryEvidence` path.

### Multilingual analysis

`src/server/analysis/multilingual.ts` adds `en | ja | zh` language detection to extracted documents. `multilingual-risk-team.ts` runs a parallel sub-agent team that produces `LocalizedRiskFinding`s — expression-level and compliance-level risks per language segment — which are then folded into `ReviewIssue`s by the main pipeline.

### API surface

All HTTP endpoints live under `src/app/api/v1/`. Main resource groups:

| Path prefix | Purpose |
|---|---|
| `review-cases/` | CRUD + status transitions + analysis start/poll |
| `knowledge-documents/` | Upload, approve/unapprove, delete corpus docs |
| `chat/` | Streaming chat against a case |
| `issues/` | Read/update findings on a case |
| `case-library/` | Search past approved cases (case-history RAG) |
| `ops/` | Readiness probe, worker health |
| `sample-packages/` | Demo-only package seeds (needs `FINPROOF_ENABLE_SAMPLE_DATA=true`) |

`src/proxy.ts` is the Next.js middleware entry point — it verifies JWT bearer tokens (jwt mode) and passes through in demo mode.

### UI component organization

`src/components/` is split into feature areas rather than type:

- `workbench/` — review decision UI: `IssueList`, `IssueDetailTabs`, `CreativeViewer`, `WorkbenchDrawer`, `WorkbenchHeader`
- `intake/` — submission wizard: `IntakeStepper`, `IntakeMetaForm`, `IntakeUploadZone`, `IntakeClassificationPanel`, `IntakeRequiredMaterialsPanel`
- `queue/` — dashboard list: `QueueTable`, `QueueFilters`, `QueueMetrics`
- `ui/` — shared primitives: `DropZone`, `FilterBar`, `Stepper`, `Tabs`, `KpiCard`
- Top-level: `AppShell`, `ReviewDetailWorkspace`, `ReviewDetailLoader`, `ReviewQueue`, `KnowledgeDocumentRegistry`, `RoleSwitcher`, `SamplePackageSelector`

### Key environment variables

`.env.example` at repo root is the canonical reference. The critical knobs for local vs production:

| Variable | Local default | Production |
|---|---|---|
| `FINPROOF_REVIEW_STORE` | `mock` | `prisma` |
| `FINPROOF_AUTH_MODE` | `demo` | `jwt` |
| `FINPROOF_ANALYSIS_EXECUTION_MODE` | `inline` | `queued` |
| `FINPROOF_MODEL_PROVIDER` | `deterministic` | `router` |
| `FINPROOF_OCR_PROVIDER` | `deterministic` | `gemini` or `http` |
| `FINPROOF_RAG_PROVIDER` | `deterministic` | `postgres` |
| `FINPROOF_STORAGE_ADAPTER` | `local-metadata` | `s3` |
| `FINPROOF_ENABLE_SAMPLE_DATA` | `false` | `false` |

## Conventions

- **Path alias**: `@/*` → `src/*` (works in Next, Vitest, and tsx).
- **Tests are colocated** with source (`foo.ts` + `foo.test.ts`). Setup file: `src/test/setup.ts`. Environment is jsdom with globals.
- **Prisma client output** is `src/generated/prisma` and is gitignored from ESLint (`globalIgnores` in `eslint.config.mjs`); don't edit by hand and don't import from `@prisma/client` directly — import from `src/server/db/prisma.ts`.
- **Sample data** is opt-in. `FINPROOF_ENABLE_SAMPLE_DATA=true` and the `/api/v1/sample-packages` endpoints are for demos only; production starts with an empty queue and accepts real packages via `/reviews/new`.
- **Two Postgres URLs**: app runtime uses `DATABASE_URL` (Supabase transaction pooler in prod, port 6543). Prisma CLI (migrate/seed) uses `DIRECT_URL` (session pooler, port 5432). `prisma.config.ts` enforces this split.
- **Lint is zero-warning** (`--max-warnings=0`); the same rule runs in `.github/workflows/backend-ci.yml`.

## Production deployment

EC2 + `systemd` (one unit for the Next runtime, one for the analysis worker), Supabase Postgres, S3 for uploads. The `ops:ec2:write` script renders all unit files / deploy scripts under `ops/ec2/`; `ops:ci:write` renders the GitHub Actions workflows. Full checklist: `docs/ops/backend-production-runbook.md`. Architecture decisions: `docs/decisions/`.
