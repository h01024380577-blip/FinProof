# Product V1 RAG Agent Backend Design

## Goal

Move FinProof Agent from a demo-backed compliance workbench to the first Product V1 backend slice where approved knowledge documents, case document chunks, agent runs, issues, evidence, chat messages, draft versions, and reports are persisted and traceable.

This slice keeps the current Next.js App Router backend and `ReviewStore` abstraction. It adds the missing Product V1 data model and service contracts behind the existing route/service/store boundary instead of splitting to a separate FastAPI backend.

## Source Of Truth

This design is based on these Obsidian documents:

- `01 Product/PRD - FinProof Agent.md`
- `03 Architecture/System Architecture.md`
- `04 Data AI/Agent and RAG Requirements.md`
- `11 Specs/API Specification.md`
- `11 Specs/Data Model and ERD.md`
- `11 Specs/Agent RAG Technical Specification.md`
- `13 QA/MVP Acceptance Test Plan.md`
- `08 Decisions/Decision 004 - Data Storage Split.md`
- `08 Decisions/Decision 008 - Demo MVP API Boundary and Mock Review Store.md`
- `08 Decisions/Decision 016 - AI Model Routing Baseline.md`

## Current Backend Baseline

The current code already has the right seams:

- `src/server/reviews/review-service.ts` owns RBAC, audit, storage, upload scanning, and analysis orchestration.
- `src/server/reviews/review-store.ts` defines the persistence boundary.
- `src/server/reviews/mock-review-store.ts` and `src/server/reviews/prisma-review-store.ts` implement mock and Prisma modes.
- `src/server/analysis/review-analysis-pipeline.ts` extracts deterministic or HTTP OCR artifacts and produces lexical evidence candidates.
- `src/server/analysis/analysis-worker.ts` claims queued jobs and completes/fails them.
- `src/server/ai/model-router.ts` implements the accepted model routing baseline.
- `prisma/schema.prisma` persists tenants, users, review cases, files, issues, evidence, analysis jobs, and audit logs.

The main gap is that analysis artifacts stop at `AnalysisJob.artifacts`. Product V1 needs those artifacts to become auditable domain records: chunks, agent runs, issues, evidence, chat, draft versions, and reports.

## Product Slice Scope

This slice adds these capabilities:

- Knowledge document upload metadata and approval state.
- Evidence chunks for approved knowledge documents and per-review uploaded files.
- Agent run and finding records for explainable analysis execution.
- Analysis completion that persists generated `ReviewIssue` and `Evidence` records.
- Chat sessions and messages tied to review cases and optional issues.
- Mark-for-draft state on assistant messages.
- Draft versions instead of only `ReviewCase.currentDraft`.
- Persisted markdown review reports.
- Case library read API backed by finalized review cases.
- API contract hardening for list pagination and consistent `{ items, page, pageSize, total }` responses while preserving existing UI compatibility during migration.

## Non-Goals

This slice does not implement:

- A separate FastAPI service.
- Full pgvector tuning or a production vector database operations runbook.
- PDF/DOCX rendering.
- External legal/regulatory update monitoring.
- A complete knowledge-base admin UI.
- Presigned multipart upload.
- Real OCR quality benchmarking.

Those remain follow-up slices after the data and API contracts exist.

## Architecture

The architecture remains adapter-first:

```text
Next route handler
  -> requestContext()
  -> ReviewService
  -> ReviewStore interface
  -> mock or Prisma implementation
```

Analysis execution becomes:

```text
Reviewer starts analysis
  -> AnalysisJob queued or inline
  -> worker claims job
  -> OCR provider extracts documents
  -> chunker normalizes review-file chunks
  -> retriever selects knowledge/case chunks
  -> agent orchestrator creates agent runs/findings
  -> issue writer persists ReviewIssue and Evidence
  -> job completes with artifact summary
```

The deterministic path remains first-class. Local tests and demo mode must work without external OCR, model, or database services.

## Data Model Changes

Add Prisma models:

- `KnowledgeDocument`
  - Tenant-scoped metadata for law, internal policy, checklist, guide, and product-policy documents.
  - Approval state gates RAG retrieval.
  - Stores `storageKey`, version, effective dates, creator, approver.

- `EvidenceChunk`
  - Chunk text and metadata derived from either a `KnowledgeDocument` or a `ReviewFile`.
  - Stores embedding model, optional vector id, page, section, summary, token estimate, and checksum.
  - For this slice, actual vector storage can be represented by `embeddingId`; lexical retrieval remains allowed.

- `AgentRun`
  - One row per agent execution under an analysis job.
  - Stores agent type, model route metadata, input/output snapshots, status, timing, token estimates, and escalation reason.

- `AgentFinding`
  - Structured candidate finding produced by an agent run.
  - Keeps raw agent output before issue consolidation.

- `ChatSession`
  - Review-case-scoped conversation, optionally issue-scoped.
  - Supports `issue`, `case`, `similar_case`, and `draft` modes.

- `ChatMessage`
  - User, assistant, and system messages.
  - Stores referenced evidence ids and `markedForDraft`.

- `DraftVersion`
  - Immutable draft history per review case.
  - Stores generated or manually edited draft text, source message ids, evidence ids, creator, and version number.

- `ReviewReport`
  - Persisted markdown report with report type, evidence ids, optional storage key, creator, and version.

Extend existing models:

- `ReviewIssue`
  - Add `targetFileId`, `targetPage`, `confidence`, `agentFindingId`.

- `Evidence`
  - Add `documentId`, `chunkId`, `version`, `effectiveFrom`.

Existing `ReviewCase.currentDraft` and `currentDraftVersion` remain as a denormalized pointer to the latest draft for UI compatibility.

## API Contracts

### Review List

`GET /api/v1/review-cases`

Canonical response:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0,
  "reviewCases": []
}
```

`reviewCases` is retained as a temporary compatibility alias for the current frontend. New code should read `items`.

Supported filters:

- `status`
- `productType`
- `affiliateId`
- `riskLevel`
- `page`
- `pageSize`

### Knowledge Documents

`POST /api/v1/knowledge-documents`

Creates metadata and stores uploaded document bytes through the configured storage adapter. Allowed roles: `compliance_admin`.

`GET /api/v1/knowledge-documents`

Lists tenant-scoped documents. Allowed roles: `reviewer`, `compliance_admin`.

`POST /api/v1/knowledge-documents/{documentId}/approve`

Approves a document for retrieval and creates chunks if they do not already exist. Allowed roles: `compliance_admin`.

### Chat

Add Product V1 endpoints:

- `POST /api/v1/review-cases/{caseId}/chat/sessions`
- `POST /api/v1/chat/sessions/{sessionId}/messages`
- `POST /api/v1/chat/messages/{messageId}/mark-for-draft`

Keep `POST /api/v1/review-cases/{caseId}/chat` as a compatibility shortcut that creates or uses an implicit issue-scoped session.

### Drafts

`POST /api/v1/review-cases/{caseId}/draft`

Generates and stores a new `DraftVersion`. It uses marked assistant messages plus current issue/evidence state.

`PATCH /api/v1/review-cases/{caseId}/draft`

Stores a manual edit as a new `DraftVersion`.

### Reports

`POST /api/v1/review-cases/{caseId}/reports/generate`

Generates markdown, persists `ReviewReport`, returns report metadata and content.

### Case Library

`GET /api/v1/case-library`

Returns finalized cases with issue summaries and evidence references. It is read-only in this slice.

## RBAC

Roles remain the current three-role subset:

- `requester`
- `reviewer`
- `compliance_admin`

Permissions:

- Requester can create review cases and read their tenant-scoped review status.
- Reviewer can start analysis, chat, save issue decisions, generate drafts, generate reports, and finalize cases.
- Compliance admin can do reviewer actions plus knowledge document upload/approval and readiness checks.

The broader PRD roles `knowledge_admin` and `system_admin` are not added in this slice. They require a separate auth and UI decision.

## Audit

Record audit events for:

- `knowledge_document.create`
- `knowledge_document.approve`
- `analysis.start`
- `analysis.complete`
- `analysis.fail`
- `agent_run.complete`
- `issue.persist`
- `issue.decision.save`
- `chat.message.create`
- `chat.message.mark_for_draft`
- `draft.version.create`
- `report.generate`
- `review_case.finalize`

Audit `beforeValue` and `afterValue` should store metadata and ids, not large text bodies or file bytes.

## State Rules

Analysis start:

- Allowed only for `submitted` or `analysis_waiting`.
- Returns `409 STATE_CONFLICT` for `analysis_queued`, `analysis_in_progress`, `analysis_complete`, or final states.

Analysis completion:

- Persists chunks, agent runs, findings, issues, evidence, and artifact summary in one logical operation.
- If issue persistence fails, the job fails and the review case returns to `analysis_waiting`.

Knowledge retrieval:

- Only approved knowledge documents are eligible for policy RAG.
- Current review file chunks can be used for that review case regardless of knowledge approval.

Draft generation:

- If no marked messages or evidence exist, use current fallback behavior but record `source = "fallback"`.
- If evidence exists, each generated draft version stores evidence ids.

## Testing Strategy

Use TDD at the service/store boundary first, then route tests:

- Prisma mapper tests for every new model.
- Mock store tests for deterministic knowledge/chunk/chat/report behavior.
- Service tests for RBAC, audit, analysis state conflicts, and draft/report persistence.
- Route tests for new APIs.
- Integration tests are env-gated behind `TEST_DATABASE_URL`, matching the current Prisma store pattern.
- Existing `npm run test` and `npm run lint` must pass.

## Rollout

1. Add schema and store contracts while keeping mock default behavior stable.
2. Add API routes with compatibility aliases for current frontend.
3. Switch analysis worker to persist Product V1 records in mock and Prisma stores.
4. Update frontend in a later slice to consume canonical `items`, chat sessions, draft versions, and report ids.

## Risks

- Scope creep: knowledge UI, PDF export, and full vector operations are intentionally excluded.
- Data duplication: `ReviewCase.currentDraft` remains denormalized. The source of truth becomes `DraftVersion`; current fields are compatibility pointers.
- ZIP behavior mismatch: Obsidian Decision 010 said ZIP internals stay unparsed for Demo MVP, but current code expands ZIPs. This design leaves current implementation untouched and treats ZIP policy as a separate hardening slice.
- Large text storage: audit logs must not store full prompts, full OCR text, or generated report bodies.

## Acceptance Criteria

- A compliance admin can create and approve a knowledge document.
- Approved knowledge chunks can be retrieved during analysis.
- Starting analysis creates agent run records and persists generated issues/evidence.
- Chat messages are stored and can be marked for draft.
- Draft generation creates a versioned draft record and updates the review case compatibility fields.
- Report generation creates a persisted report row and returns markdown content.
- Review list supports pagination/filter response metadata while retaining the legacy `reviewCases` alias.
- Full test and lint suites pass.
