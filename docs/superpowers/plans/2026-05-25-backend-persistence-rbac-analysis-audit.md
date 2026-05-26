# Backend Persistence, RBAC, Analysis Job, Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the FinProof Agent backend from in-memory demo state toward a first production-shaped backend slice with Postgres persistence, storage metadata adapters, request context/RBAC, analysis job state, and audit logs.

**Architecture:** Keep the existing Next.js App Router API and `ReviewStore` boundary, add a feature-flagged Prisma/Postgres implementation behind that boundary, and keep the mock store as the default for local demo stability. Route handlers should parse a `RequestContext`, call centralized service/RBAC logic, write audit events for reviewer actions, and leave OCR/RAG/object binary persistence outside this first slice.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest, Prisma ORM 7, PostgreSQL, `@prisma/adapter-pg`, `pg`, `tsx`.

---

## Scope Boundaries

Use these decisions as the source of truth:

- Obsidian `Decision 004 - Data Storage Split`: Object Storage for originals/reports, relational DB for workflow state/users/issues/audit, vector DB for RAG chunks.
- Obsidian `Decision 008 - Demo MVP API Boundary and Mock Review Store`: keep `ReviewStore` boundary and deterministic mock path.
- Obsidian `Decision 009` and `Decision 010`: upload intake stores metadata and enforces guardrails; OCR/RAG/ZIP extraction stay out of scope.
- Obsidian `Decision 014`: only `reviewer` and `compliance_admin` can start analysis.
- Obsidian `Risk Register` R-013/R-014/R-017: close the persistence gap, keep sensitive binary storage limited, and avoid pretending request body validation is transport-level upload protection.
- Prisma 7 docs checked through Context7: schema datasource URL moves to `prisma.config.ts`; generator uses `provider = "prisma-client"` with explicit output; runtime uses `PrismaClient` from generated output plus `PrismaPg` adapter.

This plan does not add real OCR, real RAG, vector search, S3 binary upload, virus scanning, private deployment packaging, or knowledge-base administration.

## File Structure

- Create `prisma/schema.prisma`: relational schema for tenant/user/case/file/issue/evidence/analysis job/audit.
- Create `prisma.config.ts`: Prisma 7 CLI config with `DATABASE_URL`.
- Create `prisma/seed.ts`: seed demo tenant, users, affiliates, and sample cases from `src/data/sample-review-cases.json`.
- Modify `package.json` and `package-lock.json`: install Prisma/Postgres packages and add DB scripts.
- Modify `.env.example`: document required DB/store/auth/storage environment variables.
- Create `src/server/auth/request-context.ts`: parse request headers into actor, tenant, role, and IP context.
- Create `src/server/auth/rbac.ts`: central permission checks.
- Create `src/server/auth/request-context.test.ts`: context/RBAC tests.
- Create `src/server/storage/storage-adapter.ts`: storage metadata adapter interface.
- Create `src/server/storage/local-metadata-storage-adapter.ts`: deterministic local/sample metadata adapter.
- Create `src/server/storage/index.ts`: adapter factory.
- Create `src/server/storage/storage-adapter.test.ts`: adapter tests.
- Modify `src/server/reviews/review-store.ts`: add scoped inputs, analysis job, and audit contracts.
- Modify `src/server/reviews/mock-review-store.ts`: keep current behavior while matching new contracts.
- Modify `src/server/reviews/mock-review-store.test.ts`: cover new contracts in mock path.
- Create `src/server/reviews/prisma-mappers.ts`: convert Prisma rows to domain types.
- Create `src/server/reviews/prisma-mappers.test.ts`: pure mapper tests.
- Create `src/server/reviews/prisma-review-store.ts`: Prisma-backed `ReviewStore`.
- Create `src/server/reviews/prisma-review-store.integration.test.ts`: env-gated Postgres integration coverage.
- Modify `src/server/reviews/index.ts`: select mock or Prisma store by `FINPROOF_REVIEW_STORE`.
- Create `src/server/reviews/review-service.ts`: RBAC, storage metadata, audit, and store orchestration.
- Create `src/server/reviews/review-service.test.ts`: service tests using mock dependencies.
- Modify `src/server/reviews/route-utils.ts`: add request context helpers and consistent error codes.
- Modify API route handlers under `src/app/api/v1/**/route.ts`: use `ReviewService` and `RequestContext`.
- Modify `src/api/review-api-routes.test.ts`: verify route-level RBAC, job response, audit side effects, and mock default behavior.
- Modify `README.md`: add DB setup commands and environment notes.

## Task 1: Add Prisma 7 And Postgres Tooling

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.env.example`
- Create: `prisma.config.ts`

- [ ] **Step 1: Add dependency and script expectations before installing**

Inspect current scripts:

```bash
sed -n '1,120p' package.json
```

Expected: package currently has `dev`, `build`, `start`, `test`, `lint`, `format`, and `format:write`, with no Prisma scripts.

- [ ] **Step 2: Install Prisma/Postgres packages**

Run:

```bash
npm install @prisma/client @prisma/adapter-pg pg
npm install -D prisma tsx @types/pg
```

Expected: `package.json` and `package-lock.json` change; `node_modules` remains untracked.

- [ ] **Step 3: Add DB scripts to `package.json`**

Add these scripts without deleting existing scripts:

```json
{
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts"
}
```

Expected final scripts section:

```json
{
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint . --max-warnings=0",
  "format": "prettier --check .",
  "format:write": "prettier --write .",
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts"
}
```

- [ ] **Step 4: Create `.env.example`**

```dotenv
# FinProof Agent local backend
DATABASE_URL="postgresql://finproof:finproof@localhost:5432/finproof_agent?schema=public"

# mock keeps the current demo path. Set prisma to use Postgres.
FINPROOF_REVIEW_STORE="mock"

# Header fallback context for local demo route calls.
FINPROOF_DEFAULT_TENANT_ID="tenant-demo"
FINPROOF_DEFAULT_REVIEWER_USER_ID="user-reviewer-demo"
FINPROOF_DEFAULT_REQUESTER_USER_ID="user-requester-demo"

# local-metadata stores deterministic metadata only. No file binary persistence in this slice.
FINPROOF_STORAGE_ADAPTER="local-metadata"
```

- [ ] **Step 5: Create `prisma.config.ts`**

```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

type Env = {
  DATABASE_URL: string;
};

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  },
  datasource: {
    url: env<Env>("DATABASE_URL")
  }
});
```

- [ ] **Step 6: Run format check**

Run:

```bash
npm run format
```

Expected before formatting if Prettier finds new files: FAIL listing `.env.example` is ignored or `prisma.config.ts` needs formatting. If it fails only on formatting, run `npm run format:write`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example prisma.config.ts
git commit -m "chore: add prisma postgres tooling"
```

## Task 2: Define Prisma Schema And Demo Seed

**Files:**

- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Create: `prisma/migrations/**`

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum RoleId {
  requester
  reviewer
  compliance_admin
}

enum UserStatus {
  active
  inactive
}

enum ReviewStatus {
  draft
  submitted
  parsing
  analysis_waiting
  analysis_queued
  analysis_in_progress
  analysis_complete
  under_review
  change_requested
  rejected
  approved
  on_hold
  archived
}

enum ProductType {
  deposit
  loan
  card
  capital
  insurance
  investment
}

enum RiskLevel {
  info
  caution
  high
  reject_recommended
}

enum ReviewFileType {
  promotional_creative
  copy_draft
  product_description
  terms
  rate_table
  checklist
  url_list
  package_archive
  misc
}

enum ParseStatus {
  pending
  parsed
  failed
}

enum IssueStatus {
  open
  reviewed
  resolved
  dismissed
}

enum SuggestedAction {
  approve
  change_request
  reject
  hold
}

enum EvidenceSourceType {
  law
  internal_policy
  product_doc
  case_history
}

enum AnalysisJobStatus {
  queued
  running
  completed
  failed
}

model Tenant {
  id         String       @id
  name       String
  status     String       @default("active")
  createdAt  DateTime     @default(now()) @map("created_at")
  updatedAt  DateTime     @updatedAt @map("updated_at")
  affiliates Affiliate[]
  users      User[]
  cases      ReviewCase[]
  auditLogs  AuditLog[]

  @@map("tenants")
}

model Affiliate {
  id        String       @id
  tenantId  String       @map("tenant_id")
  name      String
  code      String
  createdAt DateTime     @default(now()) @map("created_at")
  tenant    Tenant       @relation(fields: [tenantId], references: [id])
  cases     ReviewCase[]

  @@unique([tenantId, code])
  @@map("affiliates")
}

model User {
  id                 String       @id
  tenantId           String       @map("tenant_id")
  email              String       @unique
  name               String
  role               RoleId
  status             UserStatus   @default(active)
  createdAt          DateTime     @default(now()) @map("created_at")
  tenant             Tenant       @relation(fields: [tenantId], references: [id])
  requestedCases     ReviewCase[] @relation("ReviewRequester")
  assignedCases      ReviewCase[] @relation("ReviewReviewer")
  startedAnalysisJobs AnalysisJob[]
  auditLogs          AuditLog[]

  @@index([tenantId, role])
  @@map("users")
}

model ReviewCase {
  id                  String        @id
  tenantId            String        @map("tenant_id")
  affiliateId         String?       @map("affiliate_id")
  affiliateName       String        @map("affiliate_name")
  title               String
  productType         ProductType   @map("product_type")
  channelType         Json          @map("channel_type")
  plannedPublishDate  DateTime?     @map("planned_publish_date") @db.Date
  status              ReviewStatus
  highestRiskLevel    RiskLevel     @default(info) @map("highest_risk_level")
  requesterId         String        @map("requester_id")
  reviewerId          String?       @map("reviewer_id")
  requesterName       String        @map("requester_name")
  reviewerName        String        @map("reviewer_name")
  promotionalCopy     String        @map("promotional_copy")
  disclosure          String
  productDescription  String        @map("product_description")
  missingMaterials    Json          @map("missing_materials")
  expectedDraft       String        @map("expected_draft")
  currentDraft        String?       @map("current_draft")
  currentDraftVersion Int           @default(0) @map("current_draft_version")
  analysisNotice      String?       @map("analysis_notice")
  submittedAt         DateTime?     @map("submitted_at")
  analysisStartedAt   DateTime?     @map("analysis_started_at")
  analysisCompletedAt DateTime?     @map("analysis_completed_at")
  finalDecisionAt     DateTime?     @map("final_decision_at")
  createdAt           DateTime      @default(now()) @map("created_at")
  updatedAt           DateTime      @updatedAt @map("updated_at")
  tenant              Tenant        @relation(fields: [tenantId], references: [id])
  affiliate           Affiliate?    @relation(fields: [affiliateId], references: [id])
  requester           User          @relation("ReviewRequester", fields: [requesterId], references: [id])
  reviewer            User?         @relation("ReviewReviewer", fields: [reviewerId], references: [id])
  files               ReviewFile[]
  issues              ReviewIssue[]
  analysisJobs        AnalysisJob[]

  @@index([tenantId, status, updatedAt])
  @@index([affiliateId, productType, status])
  @@map("review_cases")
}

model ReviewFile {
  id                       String         @id
  reviewCaseId             String         @map("review_case_id")
  originalFilename         String         @map("original_filename")
  fileType                 ReviewFileType @map("file_type")
  classificationConfidence Float          @map("classification_confidence")
  parseStatus              ParseStatus    @map("parse_status")
  storageProvider          String         @map("storage_provider")
  storageKey               String         @map("storage_key")
  contentType              String         @map("content_type")
  sizeBytes                BigInt         @map("size_bytes")
  version                  Int            @default(1)
  createdAt                DateTime       @default(now()) @map("created_at")
  reviewCase               ReviewCase     @relation(fields: [reviewCaseId], references: [id], onDelete: Cascade)

  @@index([reviewCaseId, fileType])
  @@map("review_files")
}

model ReviewIssue {
  id                String          @id
  reviewCaseId      String          @map("review_case_id")
  issueType         String          @map("issue_type")
  riskLevel         RiskLevel       @map("risk_level")
  reviewerRiskLevel RiskLevel?      @map("reviewer_risk_level")
  title             String
  targetText        String          @map("target_text")
  targetBbox        Json            @map("target_bbox")
  sourceAgents      Json            @map("source_agents")
  suggestedAction   SuggestedAction @map("suggested_action")
  finalAction       SuggestedAction? @map("final_action")
  reviewerComment   String?         @map("reviewer_comment")
  status            IssueStatus
  description       String
  suggestedCopy     String          @map("suggested_copy")
  createdAt         DateTime        @default(now()) @map("created_at")
  updatedAt         DateTime        @updatedAt @map("updated_at")
  reviewCase        ReviewCase      @relation(fields: [reviewCaseId], references: [id], onDelete: Cascade)
  evidence          Evidence[]

  @@index([reviewCaseId, riskLevel])
  @@index([issueType, riskLevel])
  @@map("review_issues")
}

model Evidence {
  id             String             @id
  issueId        String             @map("issue_id")
  sourceType     EvidenceSourceType @map("source_type")
  title          String
  page           Int?
  section        String?
  quoteSummary   String             @map("quote_summary")
  relevanceScore Float              @map("relevance_score")
  createdAt      DateTime           @default(now()) @map("created_at")
  issue          ReviewIssue        @relation(fields: [issueId], references: [id], onDelete: Cascade)

  @@index([issueId, sourceType])
  @@map("evidence")
}

model AnalysisJob {
  id             String            @id
  reviewCaseId   String            @map("review_case_id")
  tenantId       String            @map("tenant_id")
  status         AnalysisJobStatus
  progress       Int               @default(0)
  currentStep    String            @map("current_step")
  startedByUserId String?          @map("started_by_user_id")
  errorMessage   String?           @map("error_message")
  queuedAt       DateTime          @default(now()) @map("queued_at")
  startedAt      DateTime?         @map("started_at")
  completedAt    DateTime?         @map("completed_at")
  reviewCase     ReviewCase        @relation(fields: [reviewCaseId], references: [id], onDelete: Cascade)
  startedBy      User?             @relation(fields: [startedByUserId], references: [id])

  @@index([tenantId, status, queuedAt])
  @@index([reviewCaseId, queuedAt])
  @@map("analysis_jobs")
}

model AuditLog {
  id          String   @id
  tenantId    String   @map("tenant_id")
  userId      String?  @map("user_id")
  action      String
  targetType  String   @map("target_type")
  targetId    String?  @map("target_id")
  beforeValue Json?    @map("before_value")
  afterValue  Json?    @map("after_value")
  ipAddress   String?  @map("ip_address")
  createdAt   DateTime @default(now()) @map("created_at")
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  user        User?    @relation(fields: [userId], references: [id])

  @@index([tenantId, targetType, targetId, createdAt])
  @@index([tenantId, action, createdAt])
  @@map("audit_logs")
}
```

- [ ] **Step 2: Generate initial migration**

Run:

```bash
npm run db:migrate -- --name init_backend_persistence
```

Expected: Prisma creates `prisma/migrations/<timestamp>_init_backend_persistence/migration.sql` and generates `src/generated/prisma`.

- [ ] **Step 3: Create `prisma/seed.ts`**

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import sampleReviewCases from "../src/data/sample-review-cases.json";
import { PrismaClient } from "../src/generated/prisma/client";
import type { ReviewCase } from "../src/domain/types";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed FinProof demo data");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});

const cases = sampleReviewCases as ReviewCase[];

function plannedDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function seedReviewCase(reviewCase: ReviewCase) {
  const affiliateId = reviewCase.affiliate.includes("광주")
    ? "aff-gwangju-bank"
    : "aff-jeonbuk-bank";

  await prisma.reviewCase.upsert({
    where: { id: reviewCase.id },
    update: {
      title: reviewCase.title,
      status: reviewCase.status,
      highestRiskLevel: reviewCase.highestRiskLevel,
      updatedAt: new Date()
    },
    create: {
      id: reviewCase.id,
      tenantId: "tenant-demo",
      affiliateId,
      affiliateName: reviewCase.affiliate,
      title: reviewCase.title,
      productType: reviewCase.productType,
      channelType: reviewCase.channelType,
      plannedPublishDate: plannedDate(reviewCase.plannedPublishDate),
      status: reviewCase.status,
      highestRiskLevel: reviewCase.highestRiskLevel,
      requesterId: "user-requester-demo",
      reviewerId: "user-reviewer-demo",
      requesterName: reviewCase.requester,
      reviewerName: reviewCase.reviewer,
      promotionalCopy: reviewCase.promotionalCopy,
      disclosure: reviewCase.disclosure,
      productDescription: reviewCase.productDescription,
      missingMaterials: reviewCase.missingMaterials,
      expectedDraft: reviewCase.expectedDraft,
      currentDraft: reviewCase.currentDraft,
      currentDraftVersion: reviewCase.currentDraftVersion ?? 0,
      analysisNotice: reviewCase.analysisNotice,
      files: {
        create: reviewCase.files.map((file) => ({
          id: file.id,
          originalFilename: file.name,
          fileType: file.fileType,
          classificationConfidence: file.classificationConfidence,
          parseStatus: file.parseStatus,
          storageProvider: file.storageProvider ?? "sample",
          storageKey: file.storageKey ?? `sample/${reviewCase.id}/${file.name}`,
          contentType: file.contentType ?? "application/octet-stream",
          sizeBytes: BigInt(file.sizeBytes ?? file.name.length * 1024)
        }))
      },
      issues: {
        create: reviewCase.issues.map((issue) => ({
          id: issue.id,
          issueType: issue.issueType,
          riskLevel: issue.riskLevel,
          reviewerRiskLevel: issue.reviewerRiskLevel,
          title: issue.title,
          targetText: issue.targetText,
          targetBbox: issue.targetBbox,
          sourceAgents: issue.sourceAgents,
          suggestedAction: issue.suggestedAction,
          finalAction: issue.finalAction,
          reviewerComment: issue.reviewerComment,
          status: issue.status,
          description: issue.description,
          suggestedCopy: issue.suggestedCopy,
          evidence: {
            create: issue.evidence.map((evidence) => ({
              id: evidence.id,
              sourceType: evidence.sourceType,
              title: evidence.title,
              page: evidence.page,
              section: evidence.section,
              quoteSummary: evidence.quoteSummary,
              relevanceScore: evidence.relevanceScore
            }))
          }
        }))
      }
    }
  });
}

async function main() {
  await prisma.tenant.upsert({
    where: { id: "tenant-demo" },
    update: { name: "FinProof Demo Tenant" },
    create: { id: "tenant-demo", name: "FinProof Demo Tenant" }
  });

  await prisma.affiliate.upsert({
    where: { tenantId_code: { tenantId: "tenant-demo", code: "gwangju-bank" } },
    update: { name: "광주은행" },
    create: {
      id: "aff-gwangju-bank",
      tenantId: "tenant-demo",
      code: "gwangju-bank",
      name: "광주은행"
    }
  });

  await prisma.affiliate.upsert({
    where: { tenantId_code: { tenantId: "tenant-demo", code: "jeonbuk-bank" } },
    update: { name: "전북은행" },
    create: {
      id: "aff-jeonbuk-bank",
      tenantId: "tenant-demo",
      code: "jeonbuk-bank",
      name: "전북은행"
    }
  });

  await prisma.user.upsert({
    where: { id: "user-requester-demo" },
    update: { role: "requester", status: "active" },
    create: {
      id: "user-requester-demo",
      tenantId: "tenant-demo",
      email: "requester.demo@finproof.local",
      name: "업로드 요청자",
      role: "requester"
    }
  });

  await prisma.user.upsert({
    where: { id: "user-reviewer-demo" },
    update: { role: "reviewer", status: "active" },
    create: {
      id: "user-reviewer-demo",
      tenantId: "tenant-demo",
      email: "reviewer.demo@finproof.local",
      name: "준법심의자 박민준",
      role: "reviewer"
    }
  });

  await prisma.user.upsert({
    where: { id: "user-admin-demo" },
    update: { role: "compliance_admin", status: "active" },
    create: {
      id: "user-admin-demo",
      tenantId: "tenant-demo",
      email: "admin.demo@finproof.local",
      name: "컴플라이언스 관리자",
      role: "compliance_admin"
    }
  });

  for (const reviewCase of cases) {
    await seedReviewCase(reviewCase);
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 4: Seed local DB**

Run:

```bash
npm run db:seed
```

Expected: command exits 0 and inserts/updates demo tenant, users, affiliates, files, issues, and evidence.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/seed.ts prisma/migrations
git commit -m "feat: add finproof postgres schema"
```

## Task 3: Add Request Context And RBAC

**Files:**

- Create: `src/server/auth/request-context.ts`
- Create: `src/server/auth/rbac.ts`
- Create: `src/server/auth/request-context.test.ts`
- Modify: `src/server/reviews/route-utils.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/auth/request-context.test.ts`:

```ts
import { ForbiddenError, requireRole } from "./rbac";
import { getRequestContext } from "./request-context";

function requestWithHeaders(headers: Record<string, string>) {
  return new Request("http://localhost/api/v1/review-cases", { headers });
}

describe("request context", () => {
  it("defaults to reviewer context for local demo requests", () => {
    const context = getRequestContext(requestWithHeaders({}));

    expect(context).toMatchObject({
      tenantId: "tenant-demo",
      userId: "user-reviewer-demo",
      role: "reviewer"
    });
  });

  it("parses explicit requester headers", () => {
    const context = getRequestContext(
      requestWithHeaders({
        "x-finproof-tenant-id": "tenant-a",
        "x-finproof-user-id": "user-a",
        "x-finproof-role": "requester",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1"
      })
    );

    expect(context).toEqual({
      tenantId: "tenant-a",
      userId: "user-a",
      role: "requester",
      ipAddress: "203.0.113.10"
    });
  });

  it("rejects requester for reviewer-only operations", () => {
    expect(() => {
      requireRole(
        { tenantId: "tenant-demo", userId: "user-requester-demo", role: "requester" },
        ["reviewer", "compliance_admin"],
        "start analysis"
      );
    }).toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/server/auth/request-context.test.ts
```

Expected: FAIL because `request-context.ts` and `rbac.ts` do not exist.

- [ ] **Step 3: Create `src/server/auth/request-context.ts`**

```ts
import type { RoleId } from "@/domain/types";

export type RequestContext = {
  tenantId: string;
  userId: string;
  role: RoleId;
  ipAddress?: string;
};

const roles: RoleId[] = ["requester", "reviewer", "compliance_admin"];

function parseRole(value: string | null): RoleId {
  return roles.includes(value as RoleId) ? (value as RoleId) : "reviewer";
}

function firstForwardedIp(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

export function getRequestContext(request: Request): RequestContext {
  const role = parseRole(request.headers.get("x-finproof-role"));
  const fallbackUserId =
    role === "requester"
      ? (process.env.FINPROOF_DEFAULT_REQUESTER_USER_ID ?? "user-requester-demo")
      : (process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo");

  return {
    tenantId:
      request.headers.get("x-finproof-tenant-id") ??
      process.env.FINPROOF_DEFAULT_TENANT_ID ??
      "tenant-demo",
    userId: request.headers.get("x-finproof-user-id") ?? fallbackUserId,
    role,
    ipAddress: firstForwardedIp(request.headers.get("x-forwarded-for"))
  };
}
```

- [ ] **Step 4: Create `src/server/auth/rbac.ts`**

```ts
import type { RoleId } from "@/domain/types";
import type { RequestContext } from "./request-context";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function requireRole(context: RequestContext, allowedRoles: RoleId[], actionLabel: string) {
  if (!allowedRoles.includes(context.role)) {
    throw new ForbiddenError(`${allowedRoles.join(" or ")} role is required to ${actionLabel}`);
  }
}

export function canStartAnalysis(role: RoleId): boolean {
  return role === "reviewer" || role === "compliance_admin";
}
```

- [ ] **Step 5: Add helpers to `src/server/reviews/route-utils.ts`**

```ts
import { NextResponse } from "next/server";
import type { RiskLevel } from "@/domain/types";
import { ForbiddenError } from "@/server/auth/rbac";
import { getRequestContext, type RequestContext } from "@/server/auth/request-context";

export type RouteContext<T extends Record<string, string>> = {
  params: Promise<T>;
};

export function jsonError(message: string, status: number, code = "REQUEST_ERROR") {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function jsonForbidden(error: unknown) {
  if (error instanceof ForbiddenError) {
    return jsonError(error.message, 403, "FORBIDDEN");
  }

  throw error;
}

export function requestContext(request: Request): RequestContext {
  return getRequestContext(request);
}

export async function readJsonBody<T>(request: Request): Promise<T | undefined> {
  try {
    return (await request.json()) as T;
  } catch {
    return undefined;
  }
}

export function parseRiskLevel(value: string | null): RiskLevel | undefined {
  if (
    value === "info" ||
    value === "caution" ||
    value === "high" ||
    value === "reject_recommended"
  ) {
    return value;
  }

  return undefined;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
npm run test -- src/server/auth/request-context.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/auth src/server/reviews/route-utils.ts
git commit -m "feat: add request context and rbac"
```

## Task 4: Add Storage Metadata Adapter

**Files:**

- Create: `src/server/storage/storage-adapter.ts`
- Create: `src/server/storage/local-metadata-storage-adapter.ts`
- Create: `src/server/storage/index.ts`
- Create: `src/server/storage/storage-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/storage/storage-adapter.test.ts`:

```ts
import { createLocalMetadataStorageAdapter } from "./local-metadata-storage-adapter";

describe("local metadata storage adapter", () => {
  it("creates deterministic review file metadata without persisting binary content", async () => {
    const adapter = createLocalMetadataStorageAdapter();

    const result = await adapter.putReviewFile({
      reviewCaseId: "rc-upload-001",
      fileId: "file-upload-001",
      fileName: "real-deposit-poster.png",
      contentType: "image/png",
      sizeBytes: 2048
    });

    expect(result).toEqual({
      storageProvider: "local",
      storageKey: "local/rc-upload-001/file-upload-001/real-deposit-poster.png",
      contentType: "image/png",
      sizeBytes: 2048
    });
  });

  it("creates sample metadata for seeded files", () => {
    const adapter = createLocalMetadataStorageAdapter();

    expect(
      adapter.sampleReviewFile({
        reviewCaseId: "rc-demo-deposit-001",
        fileName: "deposit-poster.png",
        contentType: "image/png",
        sizeBytes: 1024
      })
    ).toEqual({
      storageProvider: "sample",
      storageKey: "sample/rc-demo-deposit-001/deposit-poster.png",
      contentType: "image/png",
      sizeBytes: 1024
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/server/storage/storage-adapter.test.ts
```

Expected: FAIL because storage adapter files do not exist.

- [ ] **Step 3: Create `src/server/storage/storage-adapter.ts`**

```ts
export type StoredFileMetadata = {
  storageProvider: "sample" | "local" | "s3";
  storageKey: string;
  contentType: string;
  sizeBytes: number;
};

export type PutReviewFileInput = {
  reviewCaseId: string;
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type SampleReviewFileInput = {
  reviewCaseId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export interface ReviewStorageAdapter {
  putReviewFile(input: PutReviewFileInput): Promise<StoredFileMetadata>;
  sampleReviewFile(input: SampleReviewFileInput): StoredFileMetadata;
}
```

- [ ] **Step 4: Create `src/server/storage/local-metadata-storage-adapter.ts`**

```ts
import type {
  PutReviewFileInput,
  ReviewStorageAdapter,
  SampleReviewFileInput,
  StoredFileMetadata
} from "./storage-adapter";

function normalizeFileName(fileName: string) {
  return fileName.replaceAll("/", "_").replaceAll("\\", "_");
}

export function createLocalMetadataStorageAdapter(): ReviewStorageAdapter {
  return {
    async putReviewFile(input: PutReviewFileInput): Promise<StoredFileMetadata> {
      return {
        storageProvider: "local",
        storageKey: `local/${input.reviewCaseId}/${input.fileId}/${normalizeFileName(input.fileName)}`,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes
      };
    },

    sampleReviewFile(input: SampleReviewFileInput): StoredFileMetadata {
      return {
        storageProvider: "sample",
        storageKey: `sample/${input.reviewCaseId}/${normalizeFileName(input.fileName)}`,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes
      };
    }
  };
}
```

- [ ] **Step 5: Create `src/server/storage/index.ts`**

```ts
import { createLocalMetadataStorageAdapter } from "./local-metadata-storage-adapter";
import type { ReviewStorageAdapter } from "./storage-adapter";

export function getReviewStorageAdapter(): ReviewStorageAdapter {
  const adapter = process.env.FINPROOF_STORAGE_ADAPTER ?? "local-metadata";

  if (adapter !== "local-metadata") {
    throw new Error(`Unsupported FINPROOF_STORAGE_ADAPTER: ${adapter}`);
  }

  return createLocalMetadataStorageAdapter();
}

export type { ReviewStorageAdapter, StoredFileMetadata } from "./storage-adapter";
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
npm run test -- src/server/storage/storage-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/storage
git commit -m "feat: add review storage metadata adapter"
```

## Task 5: Extend ReviewStore Contract Without Breaking Mock Demo

**Files:**

- Modify: `src/server/reviews/review-store.ts`
- Modify: `src/server/reviews/mock-review-store.ts`
- Modify: `src/server/reviews/mock-review-store.test.ts`
- Modify: `src/server/reviews/index.ts`

- [ ] **Step 1: Write failing mock contract tests**

Append to `src/server/reviews/mock-review-store.test.ts`:

```ts
it("creates analysis jobs and audit events through the extended store contract", async () => {
  const store = createMockReviewStore();
  const scope = {
    tenantId: "tenant-demo",
    actorUserId: "user-reviewer-demo",
    actorRole: "reviewer" as const,
    ipAddress: "203.0.113.10"
  };

  await store.createReviewCaseFromSamplePackage(scope, {
    samplePackageId: "rc-demo-deposit-001"
  });

  const analysis = await store.startAnalysis(scope, "rc-demo-deposit-001");

  expect(analysis).toMatchObject({
    reviewCaseId: "rc-demo-deposit-001",
    status: "analysis_complete",
    jobId: "job-rc-demo-deposit-001-001"
  });

  const job = await store.getLatestAnalysisJob(scope, "rc-demo-deposit-001");

  expect(job).toMatchObject({
    id: "job-rc-demo-deposit-001-001",
    reviewCaseId: "rc-demo-deposit-001",
    status: "completed",
    progress: 100
  });

  await store.recordAuditEvent(scope, {
    action: "analysis.start",
    targetType: "review_case",
    targetId: "rc-demo-deposit-001",
    beforeValue: { status: "analysis_waiting" },
    afterValue: { status: "analysis_complete" }
  });

  const auditEvents = await store.listAuditEvents(scope, {
    targetType: "review_case",
    targetId: "rc-demo-deposit-001"
  });

  expect(auditEvents[0]).toMatchObject({
    action: "analysis.start",
    targetType: "review_case",
    targetId: "rc-demo-deposit-001",
    userId: "user-reviewer-demo",
    ipAddress: "203.0.113.10"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/server/reviews/mock-review-store.test.ts
```

Expected: FAIL because the interface does not accept scoped arguments and has no analysis job/audit methods.

- [ ] **Step 3: Replace the contract in `src/server/reviews/review-store.ts`**

Keep existing domain imports and replace the interface additions with:

```ts
import type {
  Evidence,
  ProductType,
  ReviewCase,
  ReviewFile,
  ReviewIssue,
  ReviewSummary,
  RiskLevel,
  RoleId
} from "@/domain/types";

export type ReviewStoreScope = {
  tenantId: string;
  actorUserId: string;
  actorRole: RoleId;
  ipAddress?: string;
};

export type CreateReviewCaseFromSamplePackageInput = {
  samplePackageId: string;
};

export type UploadedFileInput = {
  id: string;
  name: string;
  type: string;
  size: number;
  storageProvider: NonNullable<ReviewFile["storageProvider"]>;
  storageKey: string;
};

export type CreateReviewCaseFromUploadedFilesInput = {
  reviewCaseId?: string;
  title: string;
  affiliate: string;
  productType: ProductType;
  channelType: string[];
  plannedPublishDate: string;
  files: UploadedFileInput[];
};

export type CreateReviewCaseResult = {
  reviewCase: ReviewCase;
  files: ReviewCase["files"];
  missingMaterials: string[];
  analysisStartHref: string;
};

export type AnalysisJob = {
  id: string;
  reviewCaseId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  currentStep: string;
  startedByUserId?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
};

export type AnalysisResult = {
  reviewCaseId: string;
  status: Extract<ReviewCase["status"], "analysis_queued" | "analysis_complete">;
  issueCount: number;
  analysisHref: string;
  analysisNotice?: string;
  jobId: string;
};

export type AuditEventInput = {
  action: string;
  targetType: string;
  targetId?: string;
  beforeValue?: Record<string, unknown>;
  afterValue?: Record<string, unknown>;
};

export type AuditEvent = AuditEventInput & {
  id: string;
  tenantId: string;
  userId: string;
  ipAddress?: string;
  createdAt: string;
};

export type ListAuditEventsOptions = {
  targetType?: string;
  targetId?: string;
};

export type SaveIssueDecisionInput = {
  reviewCaseId: string;
  issueId: string;
  reviewerRiskLevel: RiskLevel;
  finalAction: NonNullable<ReviewIssue["finalAction"]>;
  reviewerComment: string;
};

export type FinalReviewStatus = Extract<
  ReviewCase["status"],
  "approved" | "change_requested" | "rejected" | "on_hold"
>;

export type ListIssuesOptions = {
  riskLevel?: RiskLevel;
};

export interface ReviewStore {
  listReviewSummaries(scope: ReviewStoreScope): Promise<ReviewSummary[]>;
  getReviewCase(scope: ReviewStoreScope, id: string): Promise<ReviewCase | undefined>;
  createReviewCaseFromSamplePackage(
    scope: ReviewStoreScope,
    input: CreateReviewCaseFromSamplePackageInput
  ): Promise<CreateReviewCaseResult | undefined>;
  createReviewCaseFromUploadedFiles(
    scope: ReviewStoreScope,
    input: CreateReviewCaseFromUploadedFilesInput
  ): Promise<CreateReviewCaseResult>;
  startAnalysis(scope: ReviewStoreScope, reviewCaseId: string): Promise<AnalysisResult | undefined>;
  getLatestAnalysisJob(
    scope: ReviewStoreScope,
    reviewCaseId: string
  ): Promise<AnalysisJob | undefined>;
  listIssues(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    options?: ListIssuesOptions
  ): Promise<ReviewIssue[] | undefined>;
  getIssue(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    issueId: string
  ): Promise<ReviewIssue | undefined>;
  getIssueEvidence(scope: ReviewStoreScope, issueId: string): Promise<Evidence[] | undefined>;
  saveIssueDecision(
    scope: ReviewStoreScope,
    input: SaveIssueDecisionInput
  ): Promise<ReviewIssue | undefined>;
  saveOpinionDraft(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    draft: string
  ): Promise<ReviewCase | undefined>;
  updateReviewStatus(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    status: FinalReviewStatus
  ): Promise<ReviewCase | undefined>;
  recordAuditEvent(scope: ReviewStoreScope, input: AuditEventInput): Promise<AuditEvent>;
  listAuditEvents(scope: ReviewStoreScope, options?: ListAuditEventsOptions): Promise<AuditEvent[]>;
}
```

- [ ] **Step 4: Update `src/server/reviews/mock-review-store.ts`**

Change each method signature to accept `scope` as first argument. Use `_scope` for methods that do not inspect it. Add these local collections and helpers near `uploadSequence`:

```ts
let uploadSequence = 1;
const analysisJobs = new Map<string, AnalysisJob[]>();
const auditEvents: AuditEvent[] = [];

function nextJobId(reviewCaseId: string): string {
  const sequence = (analysisJobs.get(reviewCaseId)?.length ?? 0) + 1;

  return `job-${reviewCaseId}-${String(sequence).padStart(3, "0")}`;
}

function nowIso() {
  return new Date().toISOString();
}
```

In `createReviewCaseFromUploadedFiles`, use the new stored-file input and honor a service-provided ID so storage keys and persisted review IDs match:

```ts
const id = input.reviewCaseId ?? `rc-upload-${String(uploadSequence).padStart(3, "0")}`;
uploadSequence += 1;

const files = input.files.map<ReviewFile>((file, index) => {
  const contentType = file.type || inferContentType(file.name);
  const fileType = classifyUploadFile({ ...file, type: contentType });

  return {
    id: file.id || `file-upload-${String(index + 1).padStart(3, "0")}`,
    name: file.name,
    fileType,
    classificationConfidence: confidenceFor(fileType),
    parseStatus: "pending",
    storageProvider: file.storageProvider,
    storageKey: file.storageKey,
    contentType,
    sizeBytes: file.size
  };
});
```

Replace `startAnalysis` with:

```ts
    async startAnalysis(scope, reviewCaseId): Promise<AnalysisResult | undefined> {
      const review = cases.get(reviewCaseId);

      if (!review) {
        return undefined;
      }

      const job: AnalysisJob = {
        id: nextJobId(reviewCaseId),
        reviewCaseId,
        status: "completed",
        progress: 100,
        currentStep: "deterministic_mock_analysis",
        startedByUserId: scope.actorUserId,
        queuedAt: nowIso(),
        startedAt: nowIso(),
        completedAt: nowIso()
      };

      analysisJobs.set(reviewCaseId, [...(analysisJobs.get(reviewCaseId) ?? []), job]);

      const updatedReview: ReviewCase = {
        ...review,
        status: "analysis_complete"
      };

      cases.set(reviewCaseId, updatedReview);

      return {
        reviewCaseId,
        status: "analysis_complete",
        issueCount: updatedReview.issues.length,
        analysisHref: `/reviews/${reviewCaseId}`,
        analysisNotice: updatedReview.analysisNotice,
        jobId: job.id
      };
    },
```

Add store methods:

```ts
    async getLatestAnalysisJob(_scope, reviewCaseId) {
      return clone(analysisJobs.get(reviewCaseId)?.at(-1));
    },

    async recordAuditEvent(scope, input) {
      const event: AuditEvent = {
        id: `audit-${String(auditEvents.length + 1).padStart(3, "0")}`,
        tenantId: scope.tenantId,
        userId: scope.actorUserId,
        ipAddress: scope.ipAddress,
        createdAt: nowIso(),
        ...input
      };

      auditEvents.unshift(event);

      return clone(event);
    },

    async listAuditEvents(_scope, options = {}) {
      return clone(
        auditEvents.filter((event) => {
          if (options.targetType && event.targetType !== options.targetType) {
            return false;
          }

          if (options.targetId && event.targetId !== options.targetId) {
            return false;
          }

          return true;
        })
      );
    }
```

- [ ] **Step 5: Run mock store tests**

Run:

```bash
npm run test -- src/server/reviews/mock-review-store.test.ts
```

Expected: PASS after all call sites inside the test file pass a scope object.

- [ ] **Step 6: Commit**

```bash
git add src/server/reviews/review-store.ts src/server/reviews/mock-review-store.ts src/server/reviews/mock-review-store.test.ts src/server/reviews/index.ts
git commit -m "feat: extend review store contract"
```

## Task 6: Add Prisma Domain Mappers

**Files:**

- Create: `src/server/reviews/prisma-mappers.ts`
- Create: `src/server/reviews/prisma-mappers.test.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `src/server/reviews/prisma-mappers.test.ts`:

```ts
import { toReviewCase, toReviewSummary } from "./prisma-mappers";

const row = {
  id: "rc-demo-deposit-001",
  affiliateName: "광주은행",
  title: "최고 연 5.0% 적금 홍보물 심의",
  productType: "deposit",
  channelType: ["poster", "sns"],
  plannedPublishDate: new Date("2026-06-10T00:00:00.000Z"),
  status: "analysis_complete",
  highestRiskLevel: "high",
  requesterName: "업로드 요청자",
  reviewerName: "준법심의자 박민준",
  promotionalCopy: "최고 연 5.0%",
  disclosure: "우대 조건 있음",
  productDescription: "정기적금",
  missingMaterials: ["terms"],
  expectedDraft: "수정 요청 초안",
  currentDraft: "현재 초안",
  currentDraftVersion: 2,
  analysisNotice: null,
  files: [
    {
      id: "file-deposit-poster",
      originalFilename: "deposit-poster.png",
      fileType: "promotional_creative",
      classificationConfidence: 0.91,
      parseStatus: "parsed",
      storageProvider: "sample",
      storageKey: "sample/rc-demo-deposit-001/deposit-poster.png",
      contentType: "image/png",
      sizeBytes: BigInt(1024)
    }
  ],
  issues: [
    {
      id: "issue-deposit-rate",
      issueType: "RATE_DISPLAY_RISK",
      riskLevel: "high",
      reviewerRiskLevel: null,
      title: "최고금리 조건 표시 불충분",
      targetText: "최고 연 5.0%",
      targetBbox: [120, 230, 420, 290],
      sourceAgents: ["product_terms_agent"],
      suggestedAction: "change_request",
      finalAction: null,
      reviewerComment: null,
      status: "open",
      description: "조건 표시가 약함",
      suggestedCopy: "조건을 병기",
      evidence: [
        {
          id: "ev-deposit-product",
          sourceType: "product_doc",
          title: "정기적금 상품설명서",
          page: 3,
          section: "우대금리 조건",
          quoteSummary: "우대 조건 충족 시 적용",
          relevanceScore: 0.87
        }
      ]
    }
  ]
};

describe("prisma review mappers", () => {
  it("maps a review case row to the existing domain type", () => {
    expect(toReviewCase(row)).toMatchObject({
      id: "rc-demo-deposit-001",
      affiliate: "광주은행",
      productType: "deposit",
      plannedPublishDate: "2026-06-10",
      currentDraftVersion: 2,
      files: [
        {
          name: "deposit-poster.png",
          storageKey: "sample/rc-demo-deposit-001/deposit-poster.png",
          sizeBytes: 1024
        }
      ],
      issues: [
        {
          id: "issue-deposit-rate",
          evidence: [{ id: "ev-deposit-product" }]
        }
      ]
    });
  });

  it("maps a review summary row", () => {
    expect(toReviewSummary(row)).toEqual({
      id: "rc-demo-deposit-001",
      title: "최고 연 5.0% 적금 홍보물 심의",
      affiliate: "광주은행",
      productType: "deposit",
      plannedPublishDate: "2026-06-10",
      status: "analysis_complete",
      highestRiskLevel: "high",
      requester: "업로드 요청자",
      reviewer: "준법심의자 박민준"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/server/reviews/prisma-mappers.test.ts
```

Expected: FAIL because mapper file does not exist.

- [ ] **Step 3: Create `src/server/reviews/prisma-mappers.ts`**

```ts
import type { ReviewCase, ReviewFile, ReviewIssue, ReviewSummary } from "@/domain/types";

type PrismaFileRow = {
  id: string;
  originalFilename: string;
  fileType: ReviewFile["fileType"];
  classificationConfidence: number;
  parseStatus: ReviewFile["parseStatus"];
  storageProvider: NonNullable<ReviewFile["storageProvider"]>;
  storageKey: string;
  contentType: string;
  sizeBytes: bigint;
};

type PrismaEvidenceRow = ReviewIssue["evidence"][number];

type PrismaIssueRow = Omit<ReviewIssue, "targetBbox" | "sourceAgents" | "evidence"> & {
  targetBbox: unknown;
  sourceAgents: unknown;
  evidence: PrismaEvidenceRow[];
};

export type PrismaReviewCaseRow = {
  id: string;
  title: string;
  affiliateName: string;
  productType: ReviewCase["productType"];
  channelType: unknown;
  plannedPublishDate: Date | null;
  status: ReviewCase["status"];
  highestRiskLevel: ReviewCase["highestRiskLevel"];
  requesterName: string;
  reviewerName: string;
  promotionalCopy: string;
  disclosure: string;
  productDescription: string;
  missingMaterials: unknown;
  files: PrismaFileRow[];
  issues: PrismaIssueRow[];
  expectedDraft: string;
  currentDraft: string | null;
  currentDraftVersion: number;
  analysisNotice: string | null;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function bbox(value: unknown): [number, number, number, number] {
  const values = Array.isArray(value) ? value : [0, 0, 0, 0];

  return [
    Number(values[0] ?? 0),
    Number(values[1] ?? 0),
    Number(values[2] ?? 0),
    Number(values[3] ?? 0)
  ];
}

function dateString(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

function toFile(row: PrismaFileRow): ReviewFile {
  return {
    id: row.id,
    name: row.originalFilename,
    fileType: row.fileType,
    classificationConfidence: row.classificationConfidence,
    parseStatus: row.parseStatus,
    storageProvider: row.storageProvider,
    storageKey: row.storageKey,
    contentType: row.contentType,
    sizeBytes: Number(row.sizeBytes)
  };
}

function toIssue(row: PrismaIssueRow): ReviewIssue {
  return {
    id: row.id,
    issueType: row.issueType,
    riskLevel: row.riskLevel,
    reviewerRiskLevel: row.reviewerRiskLevel ?? undefined,
    title: row.title,
    targetText: row.targetText,
    targetBbox: bbox(row.targetBbox),
    sourceAgents: stringArray(row.sourceAgents),
    suggestedAction: row.suggestedAction,
    finalAction: row.finalAction ?? undefined,
    reviewerComment: row.reviewerComment ?? undefined,
    status: row.status,
    description: row.description,
    suggestedCopy: row.suggestedCopy,
    evidence: row.evidence
  };
}

export function toReviewCase(row: PrismaReviewCaseRow): ReviewCase {
  return {
    id: row.id,
    title: row.title,
    affiliate: row.affiliateName,
    productType: row.productType,
    channelType: stringArray(row.channelType),
    plannedPublishDate: dateString(row.plannedPublishDate),
    status: row.status,
    highestRiskLevel: row.highestRiskLevel,
    requester: row.requesterName,
    reviewer: row.reviewerName,
    promotionalCopy: row.promotionalCopy,
    disclosure: row.disclosure,
    productDescription: row.productDescription,
    missingMaterials: stringArray(row.missingMaterials),
    files: row.files.map(toFile),
    issues: row.issues.map(toIssue),
    expectedDraft: row.expectedDraft,
    currentDraft: row.currentDraft ?? undefined,
    currentDraftVersion: row.currentDraftVersion,
    analysisNotice: row.analysisNotice ?? undefined
  };
}

export function toReviewSummary(row: PrismaReviewCaseRow): ReviewSummary {
  return {
    id: row.id,
    title: row.title,
    affiliate: row.affiliateName,
    productType: row.productType,
    plannedPublishDate: dateString(row.plannedPublishDate),
    status: row.status,
    highestRiskLevel: row.highestRiskLevel,
    requester: row.requesterName,
    reviewer: row.reviewerName
  };
}
```

- [ ] **Step 4: Run mapper tests**

Run:

```bash
npm run test -- src/server/reviews/prisma-mappers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/reviews/prisma-mappers.ts src/server/reviews/prisma-mappers.test.ts
git commit -m "feat: add prisma review mappers"
```

## Task 7: Implement Prisma ReviewStore

**Files:**

- Create: `src/server/db/prisma.ts`
- Create: `src/server/reviews/prisma-review-store.ts`
- Create: `src/server/reviews/prisma-review-store.integration.test.ts`
- Modify: `src/server/reviews/index.ts`

- [ ] **Step 1: Write env-gated integration tests**

Create `src/server/reviews/prisma-review-store.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPrismaReviewStore } from "./prisma-review-store";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const scope = {
  tenantId: "tenant-demo",
  actorUserId: "user-reviewer-demo",
  actorRole: "reviewer" as const
};

describeIfDb("prisma review store", () => {
  it("lists seeded review summaries", async () => {
    const store = createPrismaReviewStore();

    const summaries = await store.listReviewSummaries(scope);

    expect(summaries.map((summary) => summary.id)).toEqual(
      expect.arrayContaining(["rc-demo-deposit-001", "rc-demo-loan-001"])
    );
  });

  it("creates analysis jobs and persists review status", async () => {
    const store = createPrismaReviewStore();
    await store.createReviewCaseFromSamplePackage(scope, {
      samplePackageId: "rc-demo-deposit-001"
    });

    const analysis = await store.startAnalysis(scope, "rc-demo-deposit-001");
    const job = await store.getLatestAnalysisJob(scope, "rc-demo-deposit-001");
    const review = await store.getReviewCase(scope, "rc-demo-deposit-001");

    expect(analysis).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "analysis_complete"
    });
    expect(job).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "completed",
      progress: 100
    });
    expect(review?.status).toBe("analysis_complete");
  });
});
```

- [ ] **Step 2: Run test to verify it fails when DB is configured**

Run:

```bash
npm run test -- src/server/reviews/prisma-review-store.integration.test.ts
```

Expected with `DATABASE_URL`: FAIL because `prisma-review-store.ts` does not exist. Expected without DB env: SKIP. This is acceptable for developers who are still on mock-only local setup.

- [ ] **Step 3: Create `src/server/db/prisma.ts`**

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  finproofPrisma?: PrismaClient;
};

function connectionString() {
  const value = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;

  if (!value) {
    throw new Error("DATABASE_URL is required when FINPROOF_REVIEW_STORE=prisma");
  }

  return value;
}

export function getPrismaClient() {
  if (!globalForPrisma.finproofPrisma) {
    globalForPrisma.finproofPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString() }),
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
    });
  }

  return globalForPrisma.finproofPrisma;
}
```

- [ ] **Step 4: Create `src/server/reviews/prisma-review-store.ts`**

Implement the Prisma-backed store with these include options and method shapes:

```ts
import { randomUUID } from "node:crypto";
import { getRequiredMaterialRows } from "@/domain/intake";
import { classifyUploadFile } from "@/domain/upload-policy";
import type { ReviewCase, ReviewFile, ReviewIssue } from "@/domain/types";
import { getPrismaClient } from "@/server/db/prisma";
import { toReviewCase, toReviewSummary } from "./prisma-mappers";
import type {
  AnalysisJob,
  AuditEvent,
  AuditEventInput,
  CreateReviewCaseFromUploadedFilesInput,
  CreateReviewCaseFromSamplePackageInput,
  CreateReviewCaseResult,
  FinalReviewStatus,
  ListAuditEventsOptions,
  ListIssuesOptions,
  ReviewStore,
  ReviewStoreScope,
  SaveIssueDecisionInput
} from "./review-store";

const reviewInclude = {
  files: true,
  issues: {
    include: {
      evidence: true
    }
  }
} as const;

const uploadAnalysisNotice = "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다.";

function plannedDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function confidenceFor(fileType: ReviewFile["fileType"]): number {
  if (fileType === "misc") {
    return 0.62;
  }

  if (fileType === "package_archive") {
    return 0.66;
  }

  if (fileType === "promotional_creative" || fileType === "rate_table") {
    return 0.78;
  }

  return 0.74;
}

function missingMaterialKeys(review: Pick<ReviewCase, "productType" | "files">): string[] {
  return getRequiredMaterialRows(review)
    .filter((row) => row.status === "missing")
    .map((row) => (row.fileType === "checklist" ? "internal_checklist" : row.fileType));
}

function defaultExpectedDraft(productType: ReviewCase["productType"]): string {
  return `${productType} 상품 실제 업로드 자료는 접수되었습니다. 현재 Demo MVP에서는 OCR/RAG 분석 전이므로 파일 분류와 누락 자료 확인 결과를 기준으로 추가 확인이 필요합니다.`;
}

function toAnalysisJob(row: {
  id: string;
  reviewCaseId: string;
  status: AnalysisJob["status"];
  progress: number;
  currentStep: string;
  startedByUserId: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
}): AnalysisJob {
  return {
    id: row.id,
    reviewCaseId: row.reviewCaseId,
    status: row.status,
    progress: row.progress,
    currentStep: row.currentStep,
    startedByUserId: row.startedByUserId ?? undefined,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    errorMessage: row.errorMessage ?? undefined
  };
}

export function createPrismaReviewStore(): ReviewStore {
  const prisma = getPrismaClient();

  return {
    async listReviewSummaries(scope) {
      const rows = await prisma.reviewCase.findMany({
        where: { tenantId: scope.tenantId },
        include: reviewInclude,
        orderBy: { updatedAt: "desc" }
      });

      return rows.map(toReviewSummary);
    },

    async getReviewCase(scope, id) {
      const row = await prisma.reviewCase.findFirst({
        where: { id, tenantId: scope.tenantId },
        include: reviewInclude
      });

      return row ? toReviewCase(row) : undefined;
    },

    async createReviewCaseFromSamplePackage(scope, input: CreateReviewCaseFromSamplePackageInput) {
      const sample = await prisma.reviewCase.findFirst({
        where: { id: input.samplePackageId, tenantId: scope.tenantId },
        include: reviewInclude
      });

      if (!sample) {
        return undefined;
      }

      const updated = await prisma.reviewCase.update({
        where: { id: sample.id },
        data: { status: "analysis_waiting" },
        include: reviewInclude
      });
      const reviewCase = toReviewCase(updated);

      return {
        reviewCase,
        files: reviewCase.files,
        missingMaterials: reviewCase.missingMaterials,
        analysisStartHref: `/api/v1/review-cases/${reviewCase.id}/analysis/start`
      };
    },

    async createReviewCaseFromUploadedFiles(scope, input: CreateReviewCaseFromUploadedFilesInput) {
      const id = input.reviewCaseId ?? `rc-${randomUUID()}`;
      const files = input.files.map((file) => {
        const contentType = file.type || "application/octet-stream";
        const fileType = classifyUploadFile({ ...file, type: contentType });

        return {
          id: file.id,
          originalFilename: file.name,
          fileType,
          classificationConfidence: confidenceFor(fileType),
          parseStatus: "pending" as const,
          storageProvider: file.storageProvider,
          storageKey: file.storageKey,
          contentType,
          sizeBytes: BigInt(file.size)
        };
      });
      const missingMaterials = missingMaterialKeys({
        productType: input.productType,
        files: files.map((file) => ({
          id: file.id,
          name: file.originalFilename,
          fileType: file.fileType,
          classificationConfidence: file.classificationConfidence,
          parseStatus: file.parseStatus,
          storageProvider: file.storageProvider as ReviewFile["storageProvider"],
          storageKey: file.storageKey,
          contentType: file.contentType,
          sizeBytes: Number(file.sizeBytes)
        }))
      });

      const created = await prisma.reviewCase.create({
        data: {
          id,
          tenantId: scope.tenantId,
          affiliateName: input.affiliate,
          title: input.title,
          productType: input.productType,
          channelType: input.channelType,
          plannedPublishDate: plannedDate(input.plannedPublishDate),
          status: "analysis_waiting",
          highestRiskLevel: "info",
          requesterId: scope.actorUserId,
          reviewerId: process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo",
          requesterName: "업로드 요청자",
          reviewerName: "준법심의자 박민준",
          promotionalCopy: "실제 업로드 자료 분석 대기",
          disclosure: uploadAnalysisNotice,
          productDescription: "실제 업로드 파일의 본문 추출은 아직 적용되지 않았습니다.",
          missingMaterials,
          expectedDraft: defaultExpectedDraft(input.productType),
          analysisNotice: uploadAnalysisNotice,
          files: { create: files }
        },
        include: reviewInclude
      });
      const reviewCase = toReviewCase(created);

      return {
        reviewCase,
        files: reviewCase.files,
        missingMaterials: reviewCase.missingMaterials,
        analysisStartHref: `/api/v1/review-cases/${reviewCase.id}/analysis/start`
      };
    },

    async startAnalysis(scope, reviewCaseId) {
      const review = await prisma.reviewCase.findFirst({
        where: { id: reviewCaseId, tenantId: scope.tenantId },
        include: reviewInclude
      });

      if (!review) {
        return undefined;
      }

      const now = new Date();
      const job = await prisma.analysisJob.create({
        data: {
          id: `job-${randomUUID()}`,
          tenantId: scope.tenantId,
          reviewCaseId,
          status: "completed",
          progress: 100,
          currentStep: "deterministic_mock_analysis",
          startedByUserId: scope.actorUserId,
          startedAt: now,
          completedAt: now
        }
      });
      const updated = await prisma.reviewCase.update({
        where: { id: reviewCaseId },
        data: {
          status: "analysis_complete",
          analysisStartedAt: now,
          analysisCompletedAt: now
        },
        include: reviewInclude
      });

      return {
        reviewCaseId,
        status: "analysis_complete",
        issueCount: updated.issues.length,
        analysisHref: `/reviews/${reviewCaseId}`,
        analysisNotice: updated.analysisNotice ?? undefined,
        jobId: job.id
      };
    },

    async getLatestAnalysisJob(scope, reviewCaseId) {
      const row = await prisma.analysisJob.findFirst({
        where: { tenantId: scope.tenantId, reviewCaseId },
        orderBy: { queuedAt: "desc" }
      });

      return row ? toAnalysisJob(row) : undefined;
    },

    async listIssues(scope, reviewCaseId, options: ListIssuesOptions = {}) {
      const review = await this.getReviewCase(scope, reviewCaseId);

      if (!review) {
        return undefined;
      }

      return options.riskLevel
        ? review.issues.filter((issue) => issue.riskLevel === options.riskLevel)
        : review.issues;
    },

    async getIssue(scope, reviewCaseId, issueId) {
      const review = await this.getReviewCase(scope, reviewCaseId);

      return review?.issues.find((issue) => issue.id === issueId);
    },

    async getIssueEvidence(scope, issueId) {
      const issue = await prisma.reviewIssue.findFirst({
        where: { id: issueId, reviewCase: { tenantId: scope.tenantId } },
        include: { evidence: true }
      });

      return issue?.evidence;
    },

    async saveIssueDecision(scope, input: SaveIssueDecisionInput) {
      const issue = await prisma.reviewIssue.findFirst({
        where: {
          id: input.issueId,
          reviewCaseId: input.reviewCaseId,
          reviewCase: { tenantId: scope.tenantId }
        }
      });

      if (!issue) {
        return undefined;
      }

      const updated = await prisma.reviewIssue.update({
        where: { id: input.issueId },
        data: {
          reviewerRiskLevel: input.reviewerRiskLevel,
          finalAction: input.finalAction,
          reviewerComment: input.reviewerComment,
          status: "reviewed"
        },
        include: { evidence: true }
      });

      return toReviewCase({
        ...(await prisma.reviewCase.findUniqueOrThrow({
          where: { id: input.reviewCaseId },
          include: reviewInclude
        }))
      }).issues.find((candidate) => candidate.id === updated.id);
    },

    async saveOpinionDraft(scope, reviewCaseId, draft) {
      const review = await prisma.reviewCase.findFirst({
        where: { id: reviewCaseId, tenantId: scope.tenantId }
      });

      if (!review) {
        return undefined;
      }

      const updated = await prisma.reviewCase.update({
        where: { id: reviewCaseId },
        data: {
          currentDraft: draft,
          currentDraftVersion: { increment: 1 }
        },
        include: reviewInclude
      });

      return toReviewCase(updated);
    },

    async updateReviewStatus(scope, reviewCaseId, status: FinalReviewStatus) {
      const review = await prisma.reviewCase.findFirst({
        where: { id: reviewCaseId, tenantId: scope.tenantId }
      });

      if (!review) {
        return undefined;
      }

      const updated = await prisma.reviewCase.update({
        where: { id: reviewCaseId },
        data: {
          status,
          finalDecisionAt: new Date()
        },
        include: reviewInclude
      });

      return toReviewCase(updated);
    },

    async recordAuditEvent(scope, input: AuditEventInput): Promise<AuditEvent> {
      const event = await prisma.auditLog.create({
        data: {
          id: `audit-${randomUUID()}`,
          tenantId: scope.tenantId,
          userId: scope.actorUserId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          beforeValue: input.beforeValue,
          afterValue: input.afterValue,
          ipAddress: scope.ipAddress
        }
      });

      return {
        id: event.id,
        tenantId: event.tenantId,
        userId: event.userId ?? scope.actorUserId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId ?? undefined,
        beforeValue: input.beforeValue,
        afterValue: input.afterValue,
        ipAddress: event.ipAddress ?? undefined,
        createdAt: event.createdAt.toISOString()
      };
    },

    async listAuditEvents(scope, options: ListAuditEventsOptions = {}) {
      const events = await prisma.auditLog.findMany({
        where: {
          tenantId: scope.tenantId,
          targetType: options.targetType,
          targetId: options.targetId
        },
        orderBy: { createdAt: "desc" }
      });

      return events.map((event) => ({
        id: event.id,
        tenantId: event.tenantId,
        userId: event.userId ?? "",
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId ?? undefined,
        beforeValue: event.beforeValue as Record<string, unknown> | undefined,
        afterValue: event.afterValue as Record<string, unknown> | undefined,
        ipAddress: event.ipAddress ?? undefined,
        createdAt: event.createdAt.toISOString()
      }));
    }
  };
}
```

- [ ] **Step 5: Modify `src/server/reviews/index.ts`**

```ts
import { createMockReviewStore } from "./mock-review-store";
import { createPrismaReviewStore } from "./prisma-review-store";
import type { ReviewStore } from "./review-store";

const defaultReviewStoreKey = Symbol.for("finproof.defaultReviewStore");

type GlobalWithReviewStore = typeof globalThis & {
  [defaultReviewStoreKey]?: ReviewStore;
};

function getGlobalReviewStoreSlot() {
  return globalThis as GlobalWithReviewStore;
}

function createConfiguredReviewStore(): ReviewStore {
  if (process.env.FINPROOF_REVIEW_STORE === "prisma") {
    return createPrismaReviewStore();
  }

  return createMockReviewStore();
}

export function getReviewStore() {
  const slot = getGlobalReviewStoreSlot();

  slot[defaultReviewStoreKey] ??= createConfiguredReviewStore();

  return slot[defaultReviewStoreKey];
}

export function resetDefaultReviewStoreForTests() {
  getGlobalReviewStoreSlot()[defaultReviewStoreKey] = createConfiguredReviewStore();
}

export type {
  AnalysisJob,
  AnalysisResult,
  AuditEvent,
  CreateReviewCaseResult,
  ListIssuesOptions,
  ReviewStore,
  ReviewStoreScope,
  SaveIssueDecisionInput
} from "./review-store";
export { createMockReviewStore, createPrismaReviewStore };
```

- [ ] **Step 6: Run focused checks**

Run:

```bash
npm run db:generate
npm run test -- src/server/reviews/prisma-mappers.test.ts src/server/reviews/mock-review-store.test.ts src/server/reviews/prisma-review-store.integration.test.ts
```

Expected: generate exits 0; mapper and mock tests pass; Prisma integration passes when DB is available or skips when DB env is absent.

- [ ] **Step 7: Commit**

```bash
git add src/server/db src/server/reviews/prisma-review-store.ts src/server/reviews/prisma-review-store.integration.test.ts src/server/reviews/index.ts
git commit -m "feat: add prisma review store"
```

## Task 8: Add Review Service For RBAC, Storage, Jobs, And Audit

**Files:**

- Create: `src/server/reviews/review-service.ts`
- Create: `src/server/reviews/review-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `src/server/reviews/review-service.test.ts`:

```ts
import { createMockReviewStore } from "./mock-review-store";
import { createReviewService } from "./review-service";

const reviewerContext = {
  tenantId: "tenant-demo",
  userId: "user-reviewer-demo",
  role: "reviewer" as const,
  ipAddress: "203.0.113.10"
};

const requesterContext = {
  tenantId: "tenant-demo",
  userId: "user-requester-demo",
  role: "requester" as const
};

describe("review service", () => {
  it("blocks requester analysis start", async () => {
    const service = createReviewService({ store: createMockReviewStore() });

    await expect(service.startAnalysis(requesterContext, "rc-demo-deposit-001")).rejects.toThrow(
      "reviewer or compliance_admin role is required to start analysis"
    );
  });

  it("starts analysis and records audit for reviewers", async () => {
    const store = createMockReviewStore();
    const service = createReviewService({ store });

    await service.createReviewCaseFromSamplePackage(reviewerContext, {
      samplePackageId: "rc-demo-deposit-001"
    });
    const result = await service.startAnalysis(reviewerContext, "rc-demo-deposit-001");
    const auditEvents = await store.listAuditEvents(
      {
        tenantId: reviewerContext.tenantId,
        actorUserId: reviewerContext.userId,
        actorRole: reviewerContext.role,
        ipAddress: reviewerContext.ipAddress
      },
      { targetType: "review_case", targetId: "rc-demo-deposit-001" }
    );

    expect(result).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "analysis_complete"
    });
    expect(auditEvents[0]).toMatchObject({
      action: "analysis.start",
      targetType: "review_case",
      targetId: "rc-demo-deposit-001"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/server/reviews/review-service.test.ts
```

Expected: FAIL because `review-service.ts` does not exist.

- [ ] **Step 3: Create `src/server/reviews/review-service.ts`**

```ts
import { randomUUID } from "node:crypto";
import { requireRole } from "@/server/auth/rbac";
import type { RequestContext } from "@/server/auth/request-context";
import { getReviewStorageAdapter, type ReviewStorageAdapter } from "@/server/storage";
import { getReviewStore } from ".";
import type {
  CreateReviewCaseFromSamplePackageInput,
  CreateReviewCaseFromUploadedFilesInput,
  FinalReviewStatus,
  ReviewStore,
  ReviewStoreScope,
  SaveIssueDecisionInput
} from "./review-store";

type ReviewServiceDeps = {
  store?: ReviewStore;
  storage?: ReviewStorageAdapter;
};

function scopeFromContext(context: RequestContext): ReviewStoreScope {
  return {
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorRole: context.role,
    ipAddress: context.ipAddress
  };
}

export function createReviewService(deps: ReviewServiceDeps = {}) {
  const store = deps.store ?? getReviewStore();
  const storage = deps.storage ?? getReviewStorageAdapter();

  return {
    async listReviewSummaries(context: RequestContext) {
      return store.listReviewSummaries(scopeFromContext(context));
    },

    async getReviewCase(context: RequestContext, reviewCaseId: string) {
      return store.getReviewCase(scopeFromContext(context), reviewCaseId);
    },

    async createReviewCaseFromSamplePackage(
      context: RequestContext,
      input: CreateReviewCaseFromSamplePackageInput
    ) {
      const scope = scopeFromContext(context);
      const result = await store.createReviewCaseFromSamplePackage(scope, input);

      if (result) {
        await store.recordAuditEvent(scope, {
          action: "review_case.create_from_sample",
          targetType: "review_case",
          targetId: result.reviewCase.id,
          afterValue: { status: result.reviewCase.status }
        });
      }

      return result;
    },

    async createReviewCaseFromUploadedFiles(
      context: RequestContext,
      input: Omit<CreateReviewCaseFromUploadedFilesInput, "files"> & {
        files: Array<{ name: string; type: string; size: number }>;
      }
    ) {
      const scope = scopeFromContext(context);
      const reviewCaseId = `rc-${randomUUID()}`;
      const files = await Promise.all(
        input.files.map(async (file, index) => {
          const fileId = `file-${randomUUID()}`;
          const metadata = await storage.putReviewFile({
            reviewCaseId,
            fileId,
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size
          });

          return {
            id: fileId,
            name: file.name,
            type: metadata.contentType,
            size: metadata.sizeBytes,
            storageProvider: metadata.storageProvider,
            storageKey: metadata.storageKey
          };
        })
      );
      const result = await store.createReviewCaseFromUploadedFiles(scope, {
        reviewCaseId,
        ...input,
        files
      });

      await store.recordAuditEvent(scope, {
        action: "review_case.create_from_upload",
        targetType: "review_case",
        targetId: result.reviewCase.id,
        afterValue: {
          status: result.reviewCase.status,
          fileCount: result.files.length,
          missingMaterials: result.missingMaterials
        }
      });

      return result;
    },

    async startAnalysis(context: RequestContext, reviewCaseId: string) {
      requireRole(context, ["reviewer", "compliance_admin"], "start analysis");

      const scope = scopeFromContext(context);
      const before = await store.getReviewCase(scope, reviewCaseId);
      const result = await store.startAnalysis(scope, reviewCaseId);

      if (result) {
        await store.recordAuditEvent(scope, {
          action: "analysis.start",
          targetType: "review_case",
          targetId: reviewCaseId,
          beforeValue: before ? { status: before.status } : undefined,
          afterValue: { status: result.status, jobId: result.jobId }
        });
      }

      return result;
    },

    async saveIssueDecision(context: RequestContext, input: SaveIssueDecisionInput) {
      requireRole(context, ["reviewer", "compliance_admin"], "save issue decision");

      const scope = scopeFromContext(context);
      const before = await store.getIssue(scope, input.reviewCaseId, input.issueId);
      const issue = await store.saveIssueDecision(scope, input);

      if (issue) {
        await store.recordAuditEvent(scope, {
          action: "issue.decision.save",
          targetType: "review_issue",
          targetId: input.issueId,
          beforeValue: before
            ? {
                reviewerRiskLevel: before.reviewerRiskLevel,
                finalAction: before.finalAction,
                reviewerComment: before.reviewerComment
              }
            : undefined,
          afterValue: {
            reviewerRiskLevel: issue.reviewerRiskLevel,
            finalAction: issue.finalAction,
            reviewerComment: issue.reviewerComment
          }
        });
      }

      return issue;
    },

    async saveOpinionDraft(context: RequestContext, reviewCaseId: string, draft: string) {
      const scope = scopeFromContext(context);
      const before = await store.getReviewCase(scope, reviewCaseId);
      const review = await store.saveOpinionDraft(scope, reviewCaseId, draft);

      if (review) {
        await store.recordAuditEvent(scope, {
          action: "draft.save",
          targetType: "review_case",
          targetId: reviewCaseId,
          beforeValue: before
            ? { currentDraftVersion: before.currentDraftVersion ?? 0 }
            : undefined,
          afterValue: { currentDraftVersion: review.currentDraftVersion ?? 0 }
        });
      }

      return review;
    },

    async updateReviewStatus(
      context: RequestContext,
      reviewCaseId: string,
      status: FinalReviewStatus
    ) {
      requireRole(context, ["reviewer", "compliance_admin"], "finalize review");

      const scope = scopeFromContext(context);
      const before = await store.getReviewCase(scope, reviewCaseId);
      const review = await store.updateReviewStatus(scope, reviewCaseId, status);

      if (review) {
        await store.recordAuditEvent(scope, {
          action: "review_case.finalize",
          targetType: "review_case",
          targetId: reviewCaseId,
          beforeValue: before ? { status: before.status } : undefined,
          afterValue: { status: review.status }
        });
      }

      return review;
    },

    async listIssues(
      context: RequestContext,
      reviewCaseId: string,
      riskLevel?: Parameters<ReviewStore["listIssues"]>[2]
    ) {
      return store.listIssues(scopeFromContext(context), reviewCaseId, riskLevel);
    },

    async getIssue(context: RequestContext, reviewCaseId: string, issueId: string) {
      return store.getIssue(scopeFromContext(context), reviewCaseId, issueId);
    },

    async getIssueEvidence(context: RequestContext, issueId: string) {
      return store.getIssueEvidence(scopeFromContext(context), issueId);
    },

    async listAuditEvents(context: RequestContext, targetType?: string, targetId?: string) {
      return store.listAuditEvents(scopeFromContext(context), { targetType, targetId });
    }
  };
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
npm run test -- src/server/reviews/review-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/reviews/review-service.ts src/server/reviews/review-service.test.ts
git commit -m "feat: add review service orchestration"
```

## Task 9: Route Handlers Use Service And Context

**Files:**

- Modify: `src/app/api/v1/review-cases/route.ts`
- Modify: `src/app/api/v1/review-cases/[caseId]/route.ts`
- Modify: `src/app/api/v1/review-cases/[caseId]/analysis/start/route.ts`
- Modify: `src/app/api/v1/review-cases/[caseId]/issues/route.ts`
- Modify: `src/app/api/v1/review-cases/[caseId]/issues/[issueId]/route.ts`
- Modify: `src/app/api/v1/issues/[issueId]/evidence/route.ts`
- Modify: `src/app/api/v1/review-cases/[caseId]/draft/route.ts`
- Modify: `src/app/api/v1/review-cases/[caseId]/finalize/route.ts`
- Modify: `src/api/review-api-routes.test.ts`

- [ ] **Step 1: Update route tests first**

In `src/api/review-api-routes.test.ts`, update expected analysis response:

```ts
expect(analysisBody).toMatchObject({
  reviewCaseId: "rc-demo-deposit-001",
  status: "analysis_complete",
  issueCount: 3,
  jobId: expect.stringMatching(/^job-/)
});
```

Add audit assertion after reviewer analysis start:

```ts
const auditResponse = await detailGET(
  new Request("http://localhost/api/v1/review-cases/rc-demo-deposit-001"),
  params({ caseId: "rc-demo-deposit-001" })
);
expect(auditResponse.status).toBe(200);
```

Keep the existing requester `403` assertion.

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
npm run test -- src/api/review-api-routes.test.ts
```

Expected: FAIL because routes still call the store directly and do not include `jobId`.

- [ ] **Step 3: Update `src/app/api/v1/review-cases/route.ts`**

Use this route structure:

```ts
import { NextResponse } from "next/server";
import type { ProductType } from "@/domain/types";
import { validateUploadedFiles } from "@/domain/upload-policy";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, readJsonBody, requestContext } from "@/server/reviews/route-utils";
```

In `GET(request: Request)`:

```ts
export async function GET(request: Request) {
  const reviewCases = await createReviewService().listReviewSummaries(requestContext(request));

  return NextResponse.json({ reviewCases });
}
```

In JSON POST sample path:

```ts
const result = await createReviewService().createReviewCaseFromSamplePackage(
  requestContext(request),
  { samplePackageId: body.samplePackageId }
);
```

In multipart path, pass context into `createFromMultipart`:

```ts
async function createFromMultipart(request: Request) {
  const context = requestContext(request);
  const formData = await request.formData();
  // keep existing validation and field parsing
  const result = await createReviewService().createReviewCaseFromUploadedFiles(context, {
    title: readString(formData, "title", "실제 업로드 심의 요청"),
    affiliate: readString(formData, "affiliate", "광주은행"),
    productType,
    channelType: channelType.length > 0 ? channelType : ["poster"],
    plannedPublishDate: readString(formData, "plannedPublishDate", "2026-06-20"),
    files
  });

  return NextResponse.json(result, { status: 201 });
}
```

- [ ] **Step 4: Update analysis route**

Replace `src/app/api/v1/review-cases/[caseId]/analysis/start/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { jsonForbidden } from "@/server/reviews/route-utils";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, requestContext, type RouteContext } from "@/server/reviews/route-utils";

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  try {
    const { caseId } = await context.params;
    const result = await createReviewService().startAnalysis(requestContext(request), caseId);

    if (!result) {
      return jsonError("Review case not found", 404, "NOT_FOUND");
    }

    return NextResponse.json(result);
  } catch (error) {
    return jsonForbidden(error);
  }
}
```

- [ ] **Step 5: Update read and mutation routes**

Apply this pattern:

```ts
const contextValue = requestContext(request);
const service = createReviewService();
```

Then replace direct `getReviewStore()` calls:

```ts
await service.getReviewCase(contextValue, caseId);
await service.listIssues(contextValue, caseId, { riskLevel });
await service.getIssueEvidence(contextValue, issueId);
await service.saveIssueDecision(contextValue, input);
await service.saveOpinionDraft(contextValue, caseId, draft);
await service.updateReviewStatus(contextValue, caseId, status);
```

For `_request` handlers, rename the parameter to `request` so a context can be parsed.

- [ ] **Step 6: Run route tests**

Run:

```bash
npm run test -- src/api/review-api-routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/v1 src/api/review-api-routes.test.ts
git commit -m "feat: route api through review service"
```

## Task 10: Verification And Docs

**Files:**

- Modify: `README.md`
- Optional modify: Obsidian decision/risk notes in a separate docs commit if the user asks for vault updates.

- [ ] **Step 1: Update `README.md` backend section**

Add:

````md
## Backend Persistence Mode

The app defaults to the deterministic mock review store:

```bash
npm run dev
```

To use PostgreSQL:

```bash
cp .env.example .env
npm run db:generate
npm run db:migrate -- --name init_backend_persistence
npm run db:seed
FINPROOF_REVIEW_STORE=prisma npm run dev
```

The first persistence slice stores review workflow state, file metadata, analysis job state, and audit events. It does not persist uploaded binary files, run OCR/RAG, extract ZIP files, or call external AI providers.
````

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run db:generate
npm run test
npm run lint
npm run build
```

Expected: all commands PASS. If `npm run build` fails because generated Prisma output is missing, run `npm run db:generate` and rerun build.

- [ ] **Step 3: Run Prisma-backed smoke test when Postgres is available**

Run:

```bash
FINPROOF_REVIEW_STORE=prisma npm run test -- src/server/reviews/prisma-review-store.integration.test.ts src/api/review-api-routes.test.ts
```

Expected: integration tests pass against seeded DB.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document backend persistence mode"
```

## Self-Review

Spec coverage:

- Postgres persistence: Tasks 1, 2, 6, 7.
- Storage adapter: Task 4 and service upload path in Task 8.
- Request context/RBAC: Task 3 and route integration in Task 9.
- Analysis job state: Task 5 and Task 7.
- Audit trail: Task 5, Task 8, and Task 9.
- Existing demo behavior preserved: mock store remains default and route tests stay in place.
- Explicitly excluded scope: real OCR/RAG/vector DB/S3 binary persistence/private install.

Placeholder scan:

- No unresolved placeholder markers or open-ended "fill in" instructions are present.
- Each task has exact files, concrete code or command blocks, expected results, and commit commands.

Type consistency:

- `RequestContext.role` uses existing `RoleId`.
- `ReviewStoreScope.actorRole` uses `RoleId`.
- `AnalysisResult.jobId` matches the mock and Prisma store implementations.
- `UploadedFileInput` carries storage metadata from the storage adapter into both stores.
