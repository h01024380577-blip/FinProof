# FinProof Agent

FinProof Agent is a Demo MVP for evidence-based financial advertising review.

## Sprint 0 Scope

- Next.js App Router + TypeScript repository setup
- Lint, format, test, and build scripts
- Dashboard, Review List, and Review Detail routes
- Shared app shell with sidebar, topbar, and role switcher
- Deterministic sample data for deposit and loan demo cases
- Component preview decision documented in `docs/decisions`

## Commands

```bash
npm install
npm run dev
npm run test
npm run lint
npm run build
```

## Backend Persistence Mode

The app defaults to the deterministic mock review store:

```bash
npm run dev
```

To use local PostgreSQL:

```bash
cp .env.example .env
docker compose up -d postgres
npm run db:generate
npm run db:migrate -- --name init_backend_persistence
npm run db:seed
npm run db:smoke
FINPROOF_REVIEW_STORE=prisma npm run dev
```

For Supabase-backed production, keep the app runtime on the transaction pooler and run Prisma
CLI commands through the session/direct connection:

```bash
DATABASE_URL="postgresql://prisma.<project-ref>:<password>@<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://prisma.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres"
npm run db:deploy
```

`prisma.config.ts` prefers `DIRECT_URL` for migrations and seed commands. The application
Prisma client uses `DATABASE_URL`, so the deployed runtime can stay on the Supabase pooler.

The first persistence slice stores review workflow state, file metadata, analysis job state,
and audit events. With `FINPROOF_STORAGE_ADAPTER=s3`, uploaded file bytes are stored in S3 before
the review case is created. With `FINPROOF_UPLOAD_SCAN_PROVIDER=http`, uploaded file bytes are
scanned before they are stored. ZIP package uploads are expanded into individual review files with
path traversal protection. Analysis start now stores OCR/RAG ingestion artifacts on the analysis
job. It does not yet persist pgvector embeddings.

`GET /api/v1/review-cases` includes role-aware `availableActions` for the review queue.
The workbench reads analysis status from
`GET /api/v1/review-cases/:caseId/analysis/status` and audit events from
`GET /api/v1/review-cases/:caseId/audit-events`.

## Production Enablement

Production deployment is implemented on AWS EC2. The Next.js runtime is built on the EC2 host
or by CI, then run as a `systemd`-managed Node.js process. Supabase remains the production
Postgres provider, and S3 remains the file object storage provider.

The configured EC2 key pair is `finproof-s3`; keep the local private key at
`security/maeum-jungsan` with `chmod 600` and never commit it.

Production mode is configured by environment variables rather than checked-in secrets:

```bash
FINPROOF_AUTH_MODE=jwt
FINPROOF_REVIEW_STORE=prisma
FINPROOF_MODEL_PROVIDER=router
FINPROOF_OCR_PROVIDER=http
FINPROOF_RAG_PROVIDER=postgres
FINPROOF_ANALYSIS_EXECUTION_MODE=queued
FINPROOF_UPLOAD_SCAN_PROVIDER=http
FINPROOF_STORAGE_ADAPTER=s3
```

After injecting real credentials, verify readiness and provision S3 with:

```bash
npm run ops:ec2:plan
npm run ops:ec2:write
npm run ops:ci:write
npm run ops:readiness
npm run ops:s3:plan
npm run ops:s3:apply
```

`npm run ops:ec2:write` renders the EC2 `systemd` unit, runtime env example, release env example,
analysis worker unit, and deploy script under `ops/ec2`.
`npm run ops:ci:write` renders GitHub Actions workflows for backend CI and manual EC2 deployment.

In production JWT mode, prefer `FINPROOF_AUTH_JWKS_URL`,
`FINPROOF_AUTH_JWT_ISSUER`, and `FINPROOF_AUTH_JWT_AUDIENCE`; `FINPROOF_AUTH_JWT_SECRET`
remains a temporary HS256 fallback for non-OIDC environments.

See `docs/ops/backend-production-runbook.md` for the full EC2, account, API key, S3, OCR/RAG
tuning, and JWT session checklist.
