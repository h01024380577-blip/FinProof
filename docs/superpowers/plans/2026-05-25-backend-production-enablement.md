# Backend Production Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production account/API key/S3/OCR/RAG/auth work operationally pluggable while preserving deterministic local demo behavior.

**Architecture:** Add provider boundaries and readiness checks instead of hard-coding external services into route handlers. Keep deterministic providers as the default; enable real providers through environment variables and scripts that can run once credentials and cloud resources exist.

**Tech Stack:** Next.js route handlers, TypeScript, Vitest, native `fetch`, Node crypto, AWS CLI-compatible provisioning script, OpenAI Responses API over HTTP.

---

### Task 1: Production Readiness Config

**Files:**

- Create: `src/server/ops/backend-config.test.ts`
- Create: `src/server/ops/backend-config.ts`
- Create: `src/app/api/v1/ops/readiness/route.ts`

- [ ] Write tests for deterministic defaults, production missing variables, and redacted secrets.
- [ ] Implement `getBackendRuntimeConfig(env)` and `assertBackendProductionReady(env)`.
- [ ] Add admin-only readiness route returning provider state and missing variables.

### Task 2: Production Auth Session Boundary

**Files:**

- Modify: `src/server/auth/request-context.test.ts`
- Modify: `src/server/auth/request-context.ts`

- [ ] Write tests for `FINPROOF_AUTH_MODE=jwt` parsing a signed bearer JWT.
- [ ] Write tests rejecting invalid JWT signatures.
- [ ] Implement HS256 JWT verification using Node crypto.
- [ ] Keep header-based demo auth as the default.

### Task 3: Model API Provider

**Files:**

- Create: `src/server/ai/model-provider.test.ts`
- Create: `src/server/ai/model-provider.ts`

- [ ] Write tests for deterministic generation.
- [ ] Write tests for OpenAI Responses API request construction and `output_text` parsing.
- [ ] Implement deterministic and OpenAI HTTP providers.

### Task 4: OCR/RAG Provider Boundaries And Tuning Config

**Files:**

- Create: `src/server/analysis/provider-config.test.ts`
- Create: `src/server/analysis/provider-config.ts`

- [ ] Write tests for OCR/RAG deterministic defaults.
- [ ] Write tests for HTTP OCR endpoint requirements.
- [ ] Write tests for RAG tuning knobs: `topK`, `minScore`, `maxContextChars`.
- [ ] Implement typed provider config parsers.

### Task 5: S3 Provisioning And Storage Enablement

**Files:**

- Create: `scripts/provision-s3.test.ts`
- Create: `scripts/provision-s3.ts`
- Modify: `src/server/storage/index.ts`
- Modify: `src/server/storage/storage-adapter.test.ts`
- Modify: `src/server/storage/storage-adapter.ts`

- [ ] Write tests for AWS CLI command generation.
- [ ] Implement a dry-run friendly S3 provisioning script.
- [ ] Add `FINPROOF_STORAGE_ADAPTER=s3` metadata mode requiring bucket/region env.

### Task 6: Documentation And Verification

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Create: `docs/ops/backend-production-runbook.md`

- [ ] Document account issuance, API key injection, S3 bucket creation, OCR/RAG tuning, and auth session setup.
- [ ] Run focused tests.
- [ ] Run full `npm run test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run format`.
- [ ] Run `npm run build`.
