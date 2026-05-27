# Backend Production Enablement Runbook

This runbook turns the deterministic demo backend into a production-ready runtime once the
operator has real cloud, model, OCR, RAG, and auth credentials.

## 1. Issue Real Operating Accounts

Create and record owners for these production accounts before deployment:

- Database: Supabase Postgres project with a dedicated Prisma DB user, a runtime pooler URL,
  and a migration/session URL.
- Model API: OpenAI project/service account with a restricted production API key.
- OCR service: production endpoint and API key if using an external OCR gateway.
- Upload scanning service: malware scanner gateway endpoint and API key. The gateway should scan
  the submitted multipart file bytes and return `clean` or `infected`.
- AWS: EC2 instance profile allowed to read runtime secrets and write S3 objects under the
  configured prefix. Use a separate operator or CI principal to create/configure the artifact
  bucket.
- Auth: identity provider or session issuer that can mint HS256 JWTs with `sub`, `tenant_id`,
  and `role` claims. Prefer an OIDC-compatible issuer with a JWKS endpoint.

## 2. Inject Secrets

Set production variables in the runtime and release secret stores, not in git:

```bash
FINPROOF_AUTH_MODE=jwt
# Preferred production auth: OIDC/JWKS.
FINPROOF_AUTH_JWKS_URL=https://...
FINPROOF_AUTH_JWT_ISSUER=https://...
FINPROOF_AUTH_JWT_AUDIENCE=finproof-agent
# Temporary fallback only when no JWKS issuer exists.
FINPROOF_AUTH_JWT_SECRET=...
FINPROOF_REVIEW_STORE=prisma
# Runtime secret: Supabase transaction pooler.
DATABASE_URL=postgresql://prisma.<project-ref>:<password>@<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
# Release/CI secret: Supabase session pooler or direct connection.
DIRECT_URL=postgresql://prisma.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres

FINPROOF_MODEL_PROVIDER=router
OPENAI_API_KEY=...
GEMINI_API_KEY=...
FINPROOF_MODEL_DEFAULT_TEXT=gpt-5-mini
FINPROOF_MODEL_ESCALATION_TEXT=gpt-5.4
FINPROOF_MODEL_HIGHEST_PRECISION_TEXT=gpt-5.5
FINPROOF_MODEL_MULTIMODAL=gemini-2.5-flash
FINPROOF_MODEL_MULTIMODAL_ESCALATION=gemini-2.5-pro
FINPROOF_EMBEDDING_PROVIDER=openai
FINPROOF_EMBEDDING_MODEL=text-embedding-3-small
FINPROOF_EMBEDDING_ESCALATION_MODEL=text-embedding-3-large

STITCH_API_KEY=...

FINPROOF_OCR_PROVIDER=http
FINPROOF_OCR_ENDPOINT=https://...
FINPROOF_OCR_API_KEY=...

FINPROOF_RAG_PROVIDER=postgres
FINPROOF_RAG_TOP_K=4
FINPROOF_RAG_MIN_SCORE=0.72
FINPROOF_RAG_MAX_CONTEXT_CHARS=6000
FINPROOF_ANALYSIS_EXECUTION_MODE=queued
FINPROOF_WORKER_TENANT_ID=tenant-demo
FINPROOF_ANALYSIS_WORKER_ID=finproof-analysis-worker

FINPROOF_UPLOAD_SCAN_PROVIDER=http
FINPROOF_UPLOAD_SCAN_ENDPOINT=https://...
FINPROOF_UPLOAD_SCAN_API_KEY=...

FINPROOF_STORAGE_ADAPTER=s3
FINPROOF_S3_BUCKET=finproof-s3
AWS_REGION=us-east-1
```

`STITCH_API_KEY` is for frontend design tooling and is not part of backend readiness yet. Keep it
in the secret store because design prompts and generated artifacts may contain private product
context.

For Supabase, use the transaction pooler URL on port `6543` as `DATABASE_URL` for the app
runtime. Use the session pooler or direct URL on port `5432` as `DIRECT_URL` for Prisma
migrations and seed commands. `prisma.config.ts` automatically prefers `DIRECT_URL` when it is
present, while the Next.js runtime Prisma client continues to use `DATABASE_URL`.

Validate the process environment before starting traffic:

```bash
npm run ops:readiness
```

At runtime, compliance admins can call:

```bash
GET /api/v1/ops/readiness
Authorization: Bearer <admin-jwt>
```

The response redacts secret values and returns `503` until all production dependencies are set.

## 3. Prepare Supabase Postgres

Create a dedicated Prisma DB user in the Supabase SQL Editor and grant it ownership-level
privileges on the `public` schema. Then run migrations from CI or a release workstation with
both `DATABASE_URL` and `DIRECT_URL` injected:

```bash
npm run db:generate
npm run db:deploy
npm run db:seed
```

Do not deploy the app with the direct migration URL unless the runtime needs it for a controlled
maintenance task. The steady-state application runtime only needs `DATABASE_URL`.

## 4. Create the S3 Bucket

Dry-run the locked-down AWS CLI commands:

```bash
FINPROOF_S3_BUCKET=finproof-s3 AWS_REGION=us-east-1 npm run ops:s3:plan
```

Apply them with an AWS principal that can create and configure the bucket:

```bash
FINPROOF_S3_BUCKET=finproof-s3 AWS_REGION=us-east-1 npm run ops:s3:apply
```

The generated commands create the bucket, block public access, enable AES256 default encryption,
and enable versioning. With `FINPROOF_STORAGE_ADAPTER=s3`, the app uploads each review file object
to S3 and records metadata as `s3://<bucket>/reviews/<reviewCaseId>/<fileId>/<fileName>`.

When `FINPROOF_UPLOAD_SCAN_PROVIDER=http`, upload intake sends each file to
`FINPROOF_UPLOAD_SCAN_ENDPOINT` before calling S3. The scanner endpoint receives multipart fields
`reviewCaseId`, `fileId`, `fileName`, `sizeBytes`, and `file`. It must return JSON like:

```json
{ "status": "clean", "scanner": "clamav-gateway" }
```

or:

```json
{ "status": "infected", "scanner": "clamav-gateway", "signature": "EICAR-Test-File" }
```

`infected` responses fail the upload with `UNSAFE_UPLOAD` and prevent object storage writes.
ZIP package uploads are also expanded before storage. The original ZIP is retained as a
`package_archive`, safe inner files are added as separate review files, and path traversal entries
fail the request with `UNSAFE_ARCHIVE`.

## 5. Tune OCR/RAG Quality

Model routing follows the accepted Obsidian decision `Decision 016 - AI Model Routing Baseline`:

- General text tasks, normal RAG chat, opinion drafts, reports: `gpt-5-mini`
- High-risk, reject-recommended, legal interpretation, evidence conflict, agent conflict: `gpt-5.4`
- Sensitive final rejection wording or executive-review output: `gpt-5.5`
- Image/PDF and visual document understanding: `gemini-2.5-flash`
- Complex visual review, dense tables, tiny disclosures, difficult OCR correction: `gemini-2.5-pro`
- Default OpenAI embeddings: `text-embedding-3-small`
- High-recall retrieval fallback: `text-embedding-3-large`

Start with conservative retrieval:

- `FINPROOF_RAG_TOP_K=4`
- `FINPROOF_RAG_MIN_SCORE=0.72`
- `FINPROOF_RAG_MAX_CONTEXT_CHARS=6000`

Tune using a fixed evaluation set of reviewed ads and expected evidence. Increase `TOP_K` when
valid evidence is missed, raise `MIN_SCORE` when unrelated evidence appears, and lower
`MAX_CONTEXT_CHARS` if model responses become diluted by long context.

When analysis starts, the backend stores OCR/RAG ingestion output in `AnalysisJob.artifacts`:

- `extractedDocuments`: file-level OCR text, source storage key, confidence, and provider.
- `evidenceCandidates`: top lexical RAG candidates generated from extracted document text.

`FINPROOF_OCR_PROVIDER=http` calls `FINPROOF_OCR_ENDPOINT` with review file metadata. Until the
pgvector retrieval layer is added, `FINPROOF_RAG_PROVIDER=postgres` uses the same stored extracted
document text and tuning knobs to generate lexical evidence candidates.

## 6. Complete Auth Sessions

Production requests use bearer JWTs. The preferred production mode verifies RS256 tokens against
`FINPROOF_AUTH_JWKS_URL` and validates `FINPROOF_AUTH_JWT_ISSUER` plus
`FINPROOF_AUTH_JWT_AUDIENCE`. If no OIDC/JWKS issuer exists yet, the backend can still verify
HS256 tokens with `FINPROOF_AUTH_JWT_SECRET`, but treat that as a transitional setup.

Required claims:

```json
{
  "sub": "user-id",
  "tenant_id": "tenant-id",
  "role": "requester | reviewer | compliance_admin",
  "exp": 1780000000
}
```

`FINPROOF_AUTH_MODE=jwt` enables proxy enforcement for `/api/v1/*` and server-side claim
verification in request context construction. Reviewer-only mutations remain protected by RBAC,
and `/api/v1/ops/readiness` requires `compliance_admin`.

## 7. Deploy Runtime On AWS EC2

Deploy the Next.js runtime after `npm run db:deploy` succeeds. The current backend plan is:

- App runtime: AWS EC2. Run the built Next.js server as a long-lived Node.js process managed by
  `systemd`.
- Database: Supabase Postgres via pooled `DATABASE_URL`.
- File metadata and workflow state: Prisma store with `FINPROOF_REVIEW_STORE=prisma`.
- File object storage: S3 with `FINPROOF_STORAGE_ADAPTER=s3`.
- Secrets: AWS Systems Manager Parameter Store or AWS Secrets Manager loaded onto the EC2 host at
  deploy/start time; never checked into git.

Baseline EC2 deployment shape:

- EC2 image: Ubuntu LTS or Amazon Linux with the Node.js version required by the project.
- EC2 key pair: AWS key pair name `finproof-s3`; local private key file
  `security/maeum-jungsan`. Keep this file out of git and set permissions with
  `chmod 600 security/maeum-jungsan`.
- Network: private subnet behind an Application Load Balancer when public traffic is needed; only
  ALB-to-EC2 app port and restricted SSH/SSM access should be allowed.
- Process: run `npm ci`, `npm run db:generate`, `npm run build`, then start `npm run start`
  through `systemd`.
- Worker: run `npm run ops:analysis:worker -- --loop` through the generated
  `finproof-agent-analysis-worker.service` when `FINPROOF_ANALYSIS_EXECUTION_MODE=queued`.
- Release step: run `npm run db:deploy` with `DIRECT_URL` available before restarting the EC2
  application service.
- Runtime env: provide `DATABASE_URL`, model keys, OCR/RAG settings, S3 settings, auth settings,
  and `STITCH_API_KEY` through the EC2 secret loading mechanism.

SSH examples:

```bash
# Ubuntu AMI
ssh -i security/maeum-jungsan ubuntu@<ec2-public-dns-or-ip>

# Amazon Linux AMI
ssh -i security/maeum-jungsan ec2-user@<ec2-public-dns-or-ip>
```

Generate the checked deployment templates:

```bash
npm run ops:ec2:write
npm run ops:ci:write
```

This writes:

- `.github/workflows/backend-ci.yml`: pull request and `main` push verification for install,
  Prisma client generation, tests, lint, and build.
- `.github/workflows/deploy-ec2.yml`: manual production deployment workflow that verifies the
  release, syncs the repo to EC2 over SSH, and runs `ops/ec2/deploy.sh`.
- `ops/ec2/finproof-agent.service`: `systemd` unit for the Next.js runtime.
- `ops/ec2/finproof-agent-analysis-worker.service`: `systemd` unit for queued OCR/RAG analysis
  jobs.
- `ops/ec2/finproof-agent.env.example`: runtime env template for
  `/etc/finproof-agent/finproof-agent.env`.
- `ops/ec2/finproof-agent.release.env.example`: release-only env template containing
  `DIRECT_URL` for migrations.
- `ops/ec2/deploy.sh`: EC2 host deploy script that installs dependencies, generates Prisma,
  builds, runs migrations, restarts `systemd`, and calls readiness.

GitHub Actions production secrets/variables:

- Secret `EC2_HOST`: EC2 public DNS name or IP reachable from the GitHub runner.
- Secret `EC2_USER`: SSH login user, for example `ubuntu` or `ec2-user`.
- Secret `EC2_SSH_PRIVATE_KEY`: private key material matching the AWS key pair `finproof-s3`.
- Variable `EC2_APP_DIR`: optional, defaults to `/opt/finproof-agent/current`.

Run `npm run ops:readiness` in the deployed environment before routing production traffic.
