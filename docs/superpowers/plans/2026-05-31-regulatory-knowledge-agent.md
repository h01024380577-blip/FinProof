# Regulatory Knowledge Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 Regulatory Knowledge Auto-Update MVP: track regulatory sources, detect source-grounded changes, run quality gates, auto-version active RAG knowledge, expose APIs/UI, and make review retrieval use applicable active knowledge.

**Architecture:** Add regulatory source/snapshot/change-set models beside the existing knowledge document model, then orchestrate deterministic source checks through a new regulatory service. Keep persistence behind the existing `ReviewStore` boundary, reuse `KnowledgeDocument` and `EvidenceChunk` for active RAG evidence, and add focused React surfaces for source health and change-set detail.

**Tech Stack:** Next.js App Router, TypeScript, Prisma 7, pgvector-backed evidence chunks, Vitest, React Testing Library, existing FinProof mock/Prisma review stores.

---

## Scope Check

This plan implements Phase 1 from the approved spec. It intentionally stops at knowledge-base activation. It does not deploy hard-coded review rules, recall existing campaigns, add a human approval workflow, or add overseas jurisdiction review.

## File Structure

- Create `src/domain/regulatory.ts`: pure helper functions for effective-date checks, active-status checks, and presentation labels.
- Modify `src/domain/types.ts`: add regulatory domain types and extend `KnowledgeDocument` and `EvidenceChunk`.
- Modify `prisma/schema.prisma`: add regulatory enums/models and extend knowledge/evidence tables.
- Create migration under `prisma/migrations/20260531190000_add_regulatory_knowledge_agent/migration.sql`.
- Create `src/server/regulatory/normalizer.ts`: normalize source text into section-level records.
- Create `src/server/regulatory/change-diff.ts`: compare normalized sections and emit source-grounded changes.
- Create `src/server/regulatory/quality-gates.ts`: deterministic quality gates for citation, schema, contradiction, retrieval, effective date, and rollback readiness.
- Create `src/server/regulatory/regulatory-knowledge-service.ts`: orchestrate source checks, change detection, quality gates, activation, and audit events.
- Modify `src/server/reviews/review-store.ts`: add regulatory persistence contracts and `effectiveOn` to knowledge search.
- Modify `src/server/reviews/mock-review-store.ts`: implement regulatory persistence in memory.
- Modify `src/server/reviews/prisma-review-store.ts`: implement regulatory persistence in Prisma.
- Modify `src/server/reviews/prisma-mappers.ts`: map extended knowledge/evidence fields if local mapper boundaries require it.
- Modify `src/server/analysis/review-analysis-pipeline.ts`: pass planned publish date to RAG retrieval.
- Create API routes under `src/app/api/v1/regulatory-sources` and `src/app/api/v1/regulatory-change-sets`.
- Create `src/components/regulatory/RegulatoryWatchDashboard.tsx`.
- Create `src/components/regulatory/RegulatoryChangeSetDetail.tsx`.
- Create `src/app/regulatory-sources/page.tsx`.
- Add focused tests beside each new or changed module.

---

### Task 1: Domain Types And Effective-Date Helpers

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/regulatory.ts`
- Test: `src/domain/regulatory.test.ts`

- [ ] **Step 1: Write the failing domain helper test**

Create `src/domain/regulatory.test.ts`:

```ts
import type { EvidenceChunk, KnowledgeDocument } from "./types";
import {
  appliesToEffectiveDate,
  isActiveEvidenceChunk,
  isActiveKnowledgeDocument,
  regulatorySourceStatusLabel
} from "./regulatory";

describe("regulatory domain helpers", () => {
  it("recognizes active knowledge and active chunks", () => {
    const document = {
      lifecycleStatus: "active",
      approvalStatus: "approved"
    } as KnowledgeDocument;
    const chunk = {
      chunkStatus: "active"
    } as EvidenceChunk;

    expect(isActiveKnowledgeDocument(document)).toBe(true);
    expect(isActiveEvidenceChunk(chunk)).toBe(true);
  });

  it("checks applicability against planned publish dates", () => {
    expect(
      appliesToEffectiveDate(
        { effectiveFrom: "2026-07-01", effectiveTo: "2026-12-31" },
        "2026-07-15"
      )
    ).toBe(true);
    expect(
      appliesToEffectiveDate(
        { effectiveFrom: "2026-07-01", effectiveTo: "2026-12-31" },
        "2026-06-30"
      )
    ).toBe(false);
    expect(
      appliesToEffectiveDate(
        { effectiveFrom: "2026-07-01", effectiveTo: "2026-12-31" },
        "2027-01-01"
      )
    ).toBe(false);
  });

  it("labels source health in Korean for the dashboard", () => {
    expect(regulatorySourceStatusLabel("active")).toBe("정상");
    expect(regulatorySourceStatusLabel("failing")).toBe("수집 실패");
    expect(regulatorySourceStatusLabel("paused")).toBe("중지");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test -- src/domain/regulatory.test.ts`

Expected: FAIL because `src/domain/regulatory.ts` does not exist and regulatory type fields are not defined.

- [ ] **Step 3: Extend shared domain types**

In `src/domain/types.ts`, add these type definitions after `KnowledgeApprovalStatus`:

```ts
export type KnowledgeLifecycleStatus = "active" | "superseded" | "inactive";
export type EvidenceChunkStatus = "active" | "superseded" | "inactive";

export type RegulatorySourceType =
  | "regulator"
  | "law_portal"
  | "association"
  | "internal_policy_repo"
  | "case_knowledge";

export type RegulatorySourceStatus = "active" | "paused" | "failing";

export type RegulatoryChangeType =
  | "created"
  | "amended"
  | "deleted"
  | "wording_changed"
  | "effective_date_changed"
  | "scope_changed"
  | "interpretation_changed";

export type RegulatoryRiskImpactLevel = "info" | "caution" | "high" | "critical";

export type QualityGateType =
  | "citation_coverage"
  | "schema_validation"
  | "contradiction_check"
  | "retrieval_regression"
  | "effective_date"
  | "rollback_ready";

export type QualityGateStatus = "passed" | "failed" | "flagged";
```

Extend `KnowledgeDocument` with optional fields:

```ts
  canonicalKey?: string;
  sourceSnapshotId?: string;
  changeSetId?: string;
  supersedesDocumentId?: string;
  lifecycleStatus?: KnowledgeLifecycleStatus;
  autoIngested?: boolean;
  sourcePublishedAt?: string;
  interpretationSummary?: string;
```

Extend `EvidenceChunk` with optional fields:

```ts
  canonicalSectionKey?: string;
  sectionNumber?: string;
  changeSetId?: string;
  supersedesChunkId?: string;
  chunkStatus?: EvidenceChunkStatus;
  impactTags?: string[];
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceReliability?: number;
```

Add these new exported types near the other domain model types:

```ts
export type RegulatorySource = {
  id: string;
  tenantId: string;
  sourceType: RegulatorySourceType;
  name: string;
  url?: string;
  repositoryPath?: string;
  pollingSchedule: string;
  trustLevel: "official" | "industry" | "internal" | "reference";
  lastCheckedAt?: string;
  status: RegulatorySourceStatus;
  createdAt: string;
  updatedAt: string;
};

export type RegulatorySnapshot = {
  id: string;
  sourceId: string;
  tenantId: string;
  sourceUrl?: string;
  title: string;
  publishedAt?: string;
  effectiveFrom?: string;
  contentHash: string;
  rawStorageKey: string;
  normalizedStorageKey: string;
  detectedDocumentType: KnowledgeDocumentType;
  fetchStatus: "fetched" | "unchanged" | "failed";
  normalizationConfidence: number;
  createdAt: string;
};

export type RegulatoryChangedSection = {
  sectionId: string;
  sectionNumber?: string;
  title: string;
  previousText?: string;
  newText?: string;
  diffSummary: string;
  citation: {
    snapshotId: string;
    sectionId: string;
  };
};

export type RegulatoryChangeSet = {
  id: string;
  tenantId: string;
  sourceId: string;
  previousSnapshotId?: string;
  newSnapshotId: string;
  changeType: RegulatoryChangeType;
  changeSummary: string;
  changedSections: RegulatoryChangedSection[];
  effectiveFrom?: string;
  riskImpactLevel: RegulatoryRiskImpactLevel;
  interpretationSummary: string;
  mappedProductTypes: ProductType[];
  mappedChannels: string[];
  mappedReviewCategories: string[];
  qualityGateStatus: QualityGateStatus;
  confidence: number;
  createdKnowledgeDocumentId?: string;
  createdAt: string;
};

export type QualityGateResult = {
  id: string;
  changeSetId: string;
  gateType: QualityGateType;
  status: QualityGateStatus;
  summary: string;
  evidence: Record<string, unknown>;
  createdAt: string;
};
```

- [ ] **Step 4: Implement domain helpers**

Create `src/domain/regulatory.ts`:

```ts
import type {
  EvidenceChunk,
  KnowledgeDocument,
  RegulatorySourceStatus
} from "./types";

type EffectiveWindow = {
  effectiveFrom?: string;
  effectiveTo?: string;
};

function dateValue(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);

  return Number.isNaN(timestamp) ? undefined : timestamp;
}

export function appliesToEffectiveDate(window: EffectiveWindow, plannedPublishDate: string): boolean {
  const planned = dateValue(plannedPublishDate);
  const from = dateValue(window.effectiveFrom);
  const to = dateValue(window.effectiveTo);

  if (planned === undefined) {
    return true;
  }

  if (from !== undefined && planned < from) {
    return false;
  }

  if (to !== undefined && planned > to) {
    return false;
  }

  return true;
}

export function isActiveKnowledgeDocument(document: KnowledgeDocument): boolean {
  return (
    document.approvalStatus === "approved" &&
    (document.lifecycleStatus === undefined || document.lifecycleStatus === "active")
  );
}

export function isActiveEvidenceChunk(chunk: EvidenceChunk): boolean {
  return chunk.chunkStatus === undefined || chunk.chunkStatus === "active";
}

export function regulatorySourceStatusLabel(status: RegulatorySourceStatus): string {
  if (status === "active") {
    return "정상";
  }

  if (status === "failing") {
    return "수집 실패";
  }

  return "중지";
}
```

- [ ] **Step 5: Run the domain test and verify it passes**

Run: `npm run test -- src/domain/regulatory.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/types.ts src/domain/regulatory.ts src/domain/regulatory.test.ts
git commit -m "feat: add regulatory domain types"
```

---

### Task 2: Prisma Schema And Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260531190000_add_regulatory_knowledge_agent/migration.sql`
- Modify: generated Prisma client files after `npm run db:generate`

- [ ] **Step 1: Add Prisma enums**

In `prisma/schema.prisma`, add these enums after `KnowledgeApprovalStatus`:

```prisma
enum KnowledgeLifecycleStatus {
  active
  superseded
  inactive
}

enum EvidenceChunkStatus {
  active
  superseded
  inactive
}

enum RegulatorySourceType {
  regulator
  law_portal
  association
  internal_policy_repo
  case_knowledge
}

enum RegulatorySourceStatus {
  active
  paused
  failing
}

enum RegulatorySnapshotFetchStatus {
  fetched
  unchanged
  failed
}

enum RegulatoryChangeType {
  created
  amended
  deleted
  wording_changed
  effective_date_changed
  scope_changed
  interpretation_changed
}

enum RegulatoryRiskImpactLevel {
  info
  caution
  high
  critical
}

enum QualityGateType {
  citation_coverage
  schema_validation
  contradiction_check
  retrieval_regression
  effective_date
  rollback_ready
}

enum QualityGateStatus {
  passed
  failed
  flagged
}
```

- [ ] **Step 2: Extend existing Prisma models**

Add relations to `Tenant`:

```prisma
  regulatorySources   RegulatorySource[]
  regulatorySnapshots RegulatorySnapshot[]
  regulatoryChangeSets RegulatoryChangeSet[]
```

Add fields to `KnowledgeDocument` before `createdAt`:

```prisma
  canonicalKey          String?                  @map("canonical_key")
  sourceSnapshotId      String?                  @map("source_snapshot_id")
  changeSetId           String?                  @map("change_set_id")
  supersedesDocumentId  String?                  @map("supersedes_document_id")
  lifecycleStatus       KnowledgeLifecycleStatus @default(active) @map("lifecycle_status")
  autoIngested          Boolean                  @default(false) @map("auto_ingested")
  sourcePublishedAt     DateTime?                @map("source_published_at") @db.Date
  interpretationSummary String?                  @map("interpretation_summary")
  sourceSnapshot        RegulatorySnapshot?      @relation(fields: [sourceSnapshotId], references: [id], onDelete: SetNull)
  changeSet             RegulatoryChangeSet?     @relation(fields: [changeSetId], references: [id], onDelete: SetNull)
  supersedesDocument    KnowledgeDocument?       @relation("KnowledgeDocumentSupersession", fields: [supersedesDocumentId], references: [id], onDelete: SetNull)
  supersededByDocuments KnowledgeDocument[]      @relation("KnowledgeDocumentSupersession")
```

Add indexes to `KnowledgeDocument`:

```prisma
  @@index([tenantId, canonicalKey, lifecycleStatus], map: "knowledge_documents_tenant_canonical_lifecycle_idx")
  @@index([changeSetId], map: "knowledge_documents_change_set_idx")
```

Add fields to `EvidenceChunk` before `metadata`:

```prisma
  canonicalSectionKey String?              @map("canonical_section_key")
  sectionNumber       String?              @map("section_number")
  changeSetId         String?              @map("change_set_id")
  supersedesChunkId   String?              @map("supersedes_chunk_id")
  chunkStatus         EvidenceChunkStatus  @default(active) @map("chunk_status")
  impactTags          Json                 @default("[]") @map("impact_tags")
  effectiveFrom       DateTime?            @map("effective_from") @db.Date
  effectiveTo         DateTime?            @map("effective_to") @db.Date
  sourceReliability   Float?               @map("source_reliability")
  changeSet           RegulatoryChangeSet? @relation(fields: [changeSetId], references: [id], onDelete: SetNull)
  supersedesChunk     EvidenceChunk?       @relation("EvidenceChunkSupersession", fields: [supersedesChunkId], references: [id], onDelete: SetNull)
  supersededByChunks  EvidenceChunk[]      @relation("EvidenceChunkSupersession")
```

Add indexes to `EvidenceChunk`:

```prisma
  @@index([tenantId, changeSetId], map: "evidence_chunks_tenant_change_set_idx")
  @@index([tenantId, chunkStatus, effectiveFrom], map: "evidence_chunks_tenant_status_effective_idx")
```

- [ ] **Step 3: Add regulatory Prisma models**

Add these models before `AuditLog`:

```prisma
model RegulatorySource {
  id              String                 @id
  tenantId        String                 @map("tenant_id")
  sourceType      RegulatorySourceType   @map("source_type")
  name            String
  url             String?
  repositoryPath  String?                @map("repository_path")
  pollingSchedule String                 @map("polling_schedule")
  trustLevel      String                 @map("trust_level")
  lastCheckedAt   DateTime?              @map("last_checked_at")
  status          RegulatorySourceStatus @default(active)
  createdAt       DateTime               @default(now()) @map("created_at")
  updatedAt       DateTime               @updatedAt @map("updated_at")
  tenant          Tenant                 @relation(fields: [tenantId], references: [id])
  snapshots       RegulatorySnapshot[]
  changeSets      RegulatoryChangeSet[]

  @@index([tenantId, sourceType, status], map: "regulatory_sources_tenant_type_status_idx")
  @@map("regulatory_sources")
}

model RegulatorySnapshot {
  id                      String                        @id
  sourceId                String                        @map("source_id")
  tenantId                String                        @map("tenant_id")
  sourceUrl               String?                       @map("source_url")
  title                   String
  publishedAt             DateTime?                     @map("published_at") @db.Date
  effectiveFrom           DateTime?                     @map("effective_from") @db.Date
  contentHash             String                        @map("content_hash")
  rawStorageKey           String                        @map("raw_storage_key")
  normalizedStorageKey    String                        @map("normalized_storage_key")
  detectedDocumentType    KnowledgeDocumentType         @map("detected_document_type")
  fetchStatus             RegulatorySnapshotFetchStatus @map("fetch_status")
  normalizationConfidence Float                         @map("normalization_confidence")
  createdAt               DateTime                      @default(now()) @map("created_at")
  tenant                  Tenant                        @relation(fields: [tenantId], references: [id])
  source                  RegulatorySource              @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  previousChangeSets      RegulatoryChangeSet[]         @relation("PreviousRegulatorySnapshot")
  newChangeSets           RegulatoryChangeSet[]         @relation("NewRegulatorySnapshot")
  knowledgeDocuments      KnowledgeDocument[]

  @@unique([sourceId, contentHash], map: "regulatory_snapshots_source_hash_unique")
  @@index([tenantId, sourceId, createdAt], map: "regulatory_snapshots_tenant_source_created_idx")
  @@map("regulatory_snapshots")
}

model RegulatoryChangeSet {
  id                     String                    @id
  tenantId               String                    @map("tenant_id")
  sourceId               String                    @map("source_id")
  previousSnapshotId     String?                   @map("previous_snapshot_id")
  newSnapshotId          String                    @map("new_snapshot_id")
  changeType             RegulatoryChangeType      @map("change_type")
  changeSummary          String                    @map("change_summary")
  changedSections        Json                      @map("changed_sections")
  effectiveFrom          DateTime?                 @map("effective_from") @db.Date
  riskImpactLevel        RegulatoryRiskImpactLevel @map("risk_impact_level")
  interpretationSummary  String                    @map("interpretation_summary")
  mappedProductTypes     Json                      @map("mapped_product_types")
  mappedChannels         Json                      @map("mapped_channels")
  mappedReviewCategories Json                      @map("mapped_review_categories")
  qualityGateStatus      QualityGateStatus         @map("quality_gate_status")
  confidence             Float
  createdKnowledgeDocumentId String?               @map("created_knowledge_document_id")
  createdAt              DateTime                  @default(now()) @map("created_at")
  tenant                 Tenant                    @relation(fields: [tenantId], references: [id])
  source                 RegulatorySource          @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  previousSnapshot       RegulatorySnapshot?       @relation("PreviousRegulatorySnapshot", fields: [previousSnapshotId], references: [id], onDelete: SetNull)
  newSnapshot            RegulatorySnapshot        @relation("NewRegulatorySnapshot", fields: [newSnapshotId], references: [id], onDelete: Cascade)
  qualityGateResults     QualityGateResult[]
  knowledgeDocuments     KnowledgeDocument[]
  evidenceChunks         EvidenceChunk[]

  @@index([tenantId, sourceId, createdAt], map: "regulatory_change_sets_tenant_source_created_idx")
  @@index([tenantId, qualityGateStatus, createdAt], map: "regulatory_change_sets_tenant_gate_created_idx")
  @@map("regulatory_change_sets")
}

model QualityGateResult {
  id          String            @id
  changeSetId String           @map("change_set_id")
  gateType    QualityGateType  @map("gate_type")
  status      QualityGateStatus
  summary     String
  evidence    Json
  createdAt   DateTime         @default(now()) @map("created_at")
  changeSet   RegulatoryChangeSet @relation(fields: [changeSetId], references: [id], onDelete: Cascade)

  @@index([changeSetId, gateType], map: "quality_gate_results_change_set_gate_idx")
  @@map("quality_gate_results")
}
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:migrate -- --name add_regulatory_knowledge_agent`

Expected: Prisma creates a migration directory and updates the generated client. If the local database is unavailable, create the migration SQL with `prisma migrate diff` only after confirming the project's usual local database workflow.

- [ ] **Step 5: Validate generated client**

Run: `npm run db:generate`

Expected: PASS and generated Prisma files include the new enums and models.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/generated/prisma
git commit -m "feat: add regulatory knowledge schema"
```

---

### Task 3: Normalizer And Change Diff

**Files:**
- Create: `src/server/regulatory/normalizer.ts`
- Create: `src/server/regulatory/normalizer.test.ts`
- Create: `src/server/regulatory/change-diff.ts`
- Create: `src/server/regulatory/change-diff.test.ts`

- [ ] **Step 1: Write the normalizer failing test**

Create `src/server/regulatory/normalizer.test.ts`:

```ts
import { normalizeRegulatoryText } from "./normalizer";

describe("normalizeRegulatoryText", () => {
  it("turns regulatory text into stable sections", () => {
    const sections = normalizeRegulatoryText({
      snapshotId: "snapshot-new",
      text: [
        "제1조 목적",
        "이 기준은 금융광고 심의 기준을 정한다.",
        "",
        "제2조 최고금리 표시",
        "최고금리 표현 시 기본금리와 우대조건을 인접 영역에 표시해야 한다."
      ].join("\n")
    });

    expect(sections).toEqual([
      {
        id: "section-001",
        snapshotId: "snapshot-new",
        sectionNumber: "제1조",
        title: "목적",
        text: "이 기준은 금융광고 심의 기준을 정한다.",
        citation: { snapshotId: "snapshot-new", sectionId: "section-001" }
      },
      {
        id: "section-002",
        snapshotId: "snapshot-new",
        sectionNumber: "제2조",
        title: "최고금리 표시",
        text: "최고금리 표현 시 기본금리와 우대조건을 인접 영역에 표시해야 한다.",
        citation: { snapshotId: "snapshot-new", sectionId: "section-002" }
      }
    ]);
  });
});
```

- [ ] **Step 2: Implement the normalizer**

Create `src/server/regulatory/normalizer.ts`:

```ts
export type NormalizedRegulatorySection = {
  id: string;
  snapshotId: string;
  sectionNumber?: string;
  title: string;
  text: string;
  citation: {
    snapshotId: string;
    sectionId: string;
  };
};

type NormalizeInput = {
  snapshotId: string;
  text: string;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function headingParts(line: string): { sectionNumber?: string; title: string } | undefined {
  const koreanArticle = line.match(/^(제\d+조(?:의\d+)?)\s*(.+)$/);

  if (koreanArticle) {
    return {
      sectionNumber: koreanArticle[1],
      title: normalizeWhitespace(koreanArticle[2])
    };
  }

  const markdownHeading = line.match(/^#{1,4}\s+(.+)$/);

  if (markdownHeading) {
    return { title: normalizeWhitespace(markdownHeading[1]) };
  }

  return undefined;
}

export function normalizeRegulatoryText({ snapshotId, text }: NormalizeInput): NormalizedRegulatorySection[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sections: Array<{ sectionNumber?: string; title: string; body: string[] }> = [];

  for (const line of lines) {
    const heading = headingParts(line);

    if (heading) {
      sections.push({ ...heading, body: [] });
      continue;
    }

    if (sections.length === 0) {
      sections.push({ title: "본문", body: [] });
    }

    sections[sections.length - 1].body.push(line);
  }

  return sections
    .filter((section) => section.body.length > 0)
    .map((section, index) => {
      const id = `section-${String(index + 1).padStart(3, "0")}`;

      return {
        id,
        snapshotId,
        sectionNumber: section.sectionNumber,
        title: section.title,
        text: normalizeWhitespace(section.body.join(" ")),
        citation: { snapshotId, sectionId: id }
      };
    });
}
```

- [ ] **Step 3: Run the normalizer test**

Run: `npm run test -- src/server/regulatory/normalizer.test.ts`

Expected: PASS.

- [ ] **Step 4: Write the diff failing test**

Create `src/server/regulatory/change-diff.test.ts`:

```ts
import { detectRegulatoryChanges } from "./change-diff";
import type { NormalizedRegulatorySection } from "./normalizer";

function section(
  snapshotId: string,
  id: string,
  title: string,
  text: string,
  sectionNumber?: string
): NormalizedRegulatorySection {
  return {
    id,
    snapshotId,
    title,
    text,
    sectionNumber,
    citation: { snapshotId, sectionId: id }
  };
}

describe("detectRegulatoryChanges", () => {
  it("detects amended and created sections", () => {
    const previous = [
      section("snapshot-old", "section-001", "최고금리 표시", "최고금리 표현 시 우대조건을 표시해야 한다.", "제2조")
    ];
    const next = [
      section(
        "snapshot-new",
        "section-001",
        "최고금리 표시",
        "최고금리 표현 시 기본금리, 우대조건, 적용 한도를 인접 영역에 표시해야 한다.",
        "제2조"
      ),
      section("snapshot-new", "section-002", "모바일 배너", "모바일 배너는 핵심 제한 조건을 같은 화면에 표시해야 한다.", "제3조")
    ];

    const changes = detectRegulatoryChanges({
      previousSnapshotId: "snapshot-old",
      newSnapshotId: "snapshot-new",
      previous,
      next
    });

    expect(changes).toEqual([
      expect.objectContaining({
        changeType: "amended",
        changedSections: [
          expect.objectContaining({
            title: "최고금리 표시",
            previousText: "최고금리 표현 시 우대조건을 표시해야 한다.",
            newText: "최고금리 표현 시 기본금리, 우대조건, 적용 한도를 인접 영역에 표시해야 한다."
          })
        ]
      }),
      expect.objectContaining({
        changeType: "created",
        changedSections: [
          expect.objectContaining({
            title: "모바일 배너",
            previousText: undefined,
            newText: "모바일 배너는 핵심 제한 조건을 같은 화면에 표시해야 한다."
          })
        ]
      })
    ]);
  });
});
```

- [ ] **Step 5: Implement deterministic diffing**

Create `src/server/regulatory/change-diff.ts`:

```ts
import type { RegulatoryChangeType, RegulatoryChangedSection } from "@/domain/types";
import type { NormalizedRegulatorySection } from "./normalizer";

export type DetectedRegulatoryChange = {
  changeType: RegulatoryChangeType;
  changedSections: RegulatoryChangedSection[];
};

type DetectInput = {
  previousSnapshotId?: string;
  newSnapshotId: string;
  previous: NormalizedRegulatorySection[];
  next: NormalizedRegulatorySection[];
};

function sectionKey(section: NormalizedRegulatorySection): string {
  return section.sectionNumber ?? section.title;
}

function diffSummary(previousText: string | undefined, newText: string | undefined): string {
  if (!previousText && newText) {
    return "신설 조항입니다.";
  }

  if (previousText && !newText) {
    return "삭제된 조항입니다.";
  }

  return "기존 조항의 문구 또는 적용 범위가 변경되었습니다.";
}

function changedSection(
  section: NormalizedRegulatorySection,
  previousText: string | undefined,
  newText: string | undefined
): RegulatoryChangedSection {
  return {
    sectionId: section.id,
    sectionNumber: section.sectionNumber,
    title: section.title,
    previousText,
    newText,
    diffSummary: diffSummary(previousText, newText),
    citation: section.citation
  };
}

export function detectRegulatoryChanges(input: DetectInput): DetectedRegulatoryChange[] {
  const previousByKey = new Map(input.previous.map((section) => [sectionKey(section), section]));
  const nextByKey = new Map(input.next.map((section) => [sectionKey(section), section]));
  const changes: DetectedRegulatoryChange[] = [];

  for (const nextSection of input.next) {
    const previousSection = previousByKey.get(sectionKey(nextSection));

    if (!previousSection) {
      changes.push({
        changeType: "created",
        changedSections: [changedSection(nextSection, undefined, nextSection.text)]
      });
      continue;
    }

    if (previousSection.text !== nextSection.text || previousSection.title !== nextSection.title) {
      changes.push({
        changeType: "amended",
        changedSections: [changedSection(nextSection, previousSection.text, nextSection.text)]
      });
    }
  }

  for (const previousSection of input.previous) {
    if (!nextByKey.has(sectionKey(previousSection))) {
      changes.push({
        changeType: "deleted",
        changedSections: [changedSection(previousSection, previousSection.text, undefined)]
      });
    }
  }

  return changes;
}
```

- [ ] **Step 6: Run regulatory module tests**

Run: `npm run test -- src/server/regulatory/normalizer.test.ts src/server/regulatory/change-diff.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/regulatory/normalizer.ts src/server/regulatory/normalizer.test.ts src/server/regulatory/change-diff.ts src/server/regulatory/change-diff.test.ts
git commit -m "feat: add regulatory normalization and diffing"
```

---

### Task 4: Quality Gate Runner

**Files:**
- Create: `src/server/regulatory/quality-gates.ts`
- Create: `src/server/regulatory/quality-gates.test.ts`

- [ ] **Step 1: Write quality gate failing tests**

Create `src/server/regulatory/quality-gates.test.ts`:

```ts
import type { RegulatoryChangeSet } from "@/domain/types";
import { runRegulatoryQualityGates } from "./quality-gates";

function changeSet(overrides: Partial<RegulatoryChangeSet> = {}): RegulatoryChangeSet {
  return {
    id: "change-set-001",
    tenantId: "tenant-demo",
    sourceId: "source-001",
    previousSnapshotId: "snapshot-old",
    newSnapshotId: "snapshot-new",
    changeType: "amended",
    changeSummary: "최고금리 표시 기준이 강화되었습니다.",
    changedSections: [
      {
        sectionId: "section-002",
        sectionNumber: "제2조",
        title: "최고금리 표시",
        previousText: "최고금리 표현 시 우대조건을 표시해야 한다.",
        newText: "최고금리 표현 시 기본금리, 우대조건, 적용 한도를 인접 영역에 표시해야 한다.",
        diffSummary: "기존 조항의 문구 또는 적용 범위가 변경되었습니다.",
        citation: { snapshotId: "snapshot-new", sectionId: "section-002" }
      }
    ],
    effectiveFrom: "2026-07-01",
    riskImpactLevel: "high",
    interpretationSummary: "최고금리 단독 강조 광고는 필수 조건 인접 고지가 필요합니다.",
    mappedProductTypes: ["deposit"],
    mappedChannels: ["mobile_banner"],
    mappedReviewCategories: ["rate_display"],
    qualityGateStatus: "passed",
    confidence: 0.91,
    createdAt: "2026-05-31T00:00:00.000Z",
    ...overrides
  };
}

describe("runRegulatoryQualityGates", () => {
  it("passes a cited, structured, date-safe change set", () => {
    const results = runRegulatoryQualityGates({
      changeSet: changeSet(),
      regressionRetrieved: true,
      rollbackTargetReady: true
    });

    expect(results.map((result) => [result.gateType, result.status])).toEqual([
      ["citation_coverage", "passed"],
      ["schema_validation", "passed"],
      ["contradiction_check", "passed"],
      ["retrieval_regression", "passed"],
      ["effective_date", "passed"],
      ["rollback_ready", "passed"]
    ]);
  });

  it("fails citation and retrieval gates when evidence is not grounded", () => {
    const results = runRegulatoryQualityGates({
      changeSet: changeSet({
        changedSections: [
          {
            sectionId: "section-002",
            title: "최고금리 표시",
            diffSummary: "근거 없는 변경입니다.",
            citation: { snapshotId: "", sectionId: "" }
          }
        ]
      }),
      regressionRetrieved: false,
      rollbackTargetReady: true
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gateType: "citation_coverage", status: "failed" }),
        expect.objectContaining({ gateType: "retrieval_regression", status: "failed" })
      ])
    );
  });
});
```

- [ ] **Step 2: Implement quality gates**

Create `src/server/regulatory/quality-gates.ts`:

```ts
import type { QualityGateResult, QualityGateStatus, QualityGateType, RegulatoryChangeSet } from "@/domain/types";

type RunQualityGatesInput = {
  changeSet: RegulatoryChangeSet;
  regressionRetrieved: boolean;
  rollbackTargetReady: boolean;
  now?: () => Date;
};

function result(
  changeSetId: string,
  gateType: QualityGateType,
  status: QualityGateStatus,
  summary: string,
  evidence: Record<string, unknown>,
  now: () => Date
): QualityGateResult {
  return {
    id: `gate-${changeSetId}-${gateType}`,
    changeSetId,
    gateType,
    status,
    summary,
    evidence,
    createdAt: now().toISOString()
  };
}

function hasCitation(changeSet: RegulatoryChangeSet): boolean {
  return changeSet.changedSections.every(
    (section) => section.citation.snapshotId.length > 0 && section.citation.sectionId.length > 0
  );
}

function hasRequiredSchema(changeSet: RegulatoryChangeSet): boolean {
  return (
    changeSet.changeSummary.trim().length > 0 &&
    changeSet.changedSections.length > 0 &&
    changeSet.interpretationSummary.trim().length > 0 &&
    changeSet.mappedProductTypes.length > 0 &&
    changeSet.mappedReviewCategories.length > 0 &&
    changeSet.confidence >= 0 &&
    changeSet.confidence <= 1
  );
}

function hasValidEffectiveDate(changeSet: RegulatoryChangeSet): boolean {
  if (!changeSet.effectiveFrom) {
    return true;
  }

  return !Number.isNaN(Date.parse(`${changeSet.effectiveFrom.slice(0, 10)}T00:00:00.000Z`));
}

function hasPotentialContradiction(changeSet: RegulatoryChangeSet): boolean {
  const text = `${changeSet.changeSummary} ${changeSet.interpretationSummary}`.toLowerCase();

  return text.includes("상위 규제와 충돌") || text.includes("conflict with higher priority");
}

export function runRegulatoryQualityGates({
  changeSet,
  regressionRetrieved,
  rollbackTargetReady,
  now = () => new Date()
}: RunQualityGatesInput): QualityGateResult[] {
  return [
    result(
      changeSet.id,
      "citation_coverage",
      hasCitation(changeSet) ? "passed" : "failed",
      hasCitation(changeSet) ? "모든 변경 섹션에 원문 citation이 있습니다." : "citation이 없는 변경 섹션이 있습니다.",
      { changedSectionCount: changeSet.changedSections.length },
      now
    ),
    result(
      changeSet.id,
      "schema_validation",
      hasRequiredSchema(changeSet) ? "passed" : "failed",
      hasRequiredSchema(changeSet) ? "필수 구조화 필드가 채워졌습니다." : "필수 구조화 필드가 비어 있습니다.",
      {
        mappedProductTypes: changeSet.mappedProductTypes,
        mappedReviewCategories: changeSet.mappedReviewCategories
      },
      now
    ),
    result(
      changeSet.id,
      "contradiction_check",
      hasPotentialContradiction(changeSet) ? "flagged" : "passed",
      hasPotentialContradiction(changeSet) ? "상위 기준 충돌 가능성이 감지되었습니다." : "상위 기준 충돌 신호가 없습니다.",
      { sourceId: changeSet.sourceId },
      now
    ),
    result(
      changeSet.id,
      "retrieval_regression",
      regressionRetrieved ? "passed" : "failed",
      regressionRetrieved ? "대표 검색 질의에서 신규 지식 청크가 검색됩니다." : "대표 검색 질의에서 신규 지식 청크가 검색되지 않았습니다.",
      { regressionRetrieved },
      now
    ),
    result(
      changeSet.id,
      "effective_date",
      hasValidEffectiveDate(changeSet) ? "passed" : "failed",
      hasValidEffectiveDate(changeSet) ? "시행일 형식이 유효합니다." : "시행일 형식이 유효하지 않습니다.",
      { effectiveFrom: changeSet.effectiveFrom },
      now
    ),
    result(
      changeSet.id,
      "rollback_ready",
      rollbackTargetReady ? "passed" : "failed",
      rollbackTargetReady ? "롤백 대상이 확인되었습니다." : "롤백 대상이 확인되지 않았습니다.",
      { rollbackTargetReady },
      now
    )
  ];
}

export function qualityGateStatus(results: QualityGateResult[]): QualityGateStatus {
  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }

  if (results.some((result) => result.status === "flagged")) {
    return "flagged";
  }

  return "passed";
}
```

- [ ] **Step 3: Run quality gate tests**

Run: `npm run test -- src/server/regulatory/quality-gates.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/regulatory/quality-gates.ts src/server/regulatory/quality-gates.test.ts
git commit -m "feat: add regulatory quality gates"
```

---

### Task 5: ReviewStore Contract And Mock Store Regulatory Persistence

**Files:**
- Modify: `src/server/reviews/review-store.ts`
- Modify: `src/server/reviews/mock-review-store.ts`
- Test: `src/server/reviews/mock-review-store.regulatory.test.ts`

- [ ] **Step 1: Write failing mock-store regulatory tests**

Create `src/server/reviews/mock-review-store.regulatory.test.ts`:

```ts
import { createMockReviewStore } from "./mock-review-store";

const scope = {
  tenantId: "tenant-demo",
  actorUserId: "user-reviewer-demo",
  actorRole: "reviewer" as const
};

describe("mock review store regulatory knowledge", () => {
  it("creates regulatory sources, snapshots, change sets, gates, and active knowledge", async () => {
    const store = createMockReviewStore([]);
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-deposit",
      sourceType: "internal_policy_repo",
      name: "예금 광고 내부 기준",
      repositoryPath: "internal/policies/deposit-ad.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });
    const snapshot = await store.createRegulatorySnapshot(scope, {
      id: "reg-snapshot-202607",
      sourceId: source.id,
      title: "예금 광고 내부 기준",
      effectiveFrom: "2026-07-01",
      contentHash: "hash-202607",
      rawStorageKey: "regulatory/raw/reg-snapshot-202607.txt",
      normalizedStorageKey: "regulatory/normalized/reg-snapshot-202607.json",
      detectedDocumentType: "internal_policy",
      fetchStatus: "fetched",
      normalizationConfidence: 0.97
    });
    const changeSet = await store.createRegulatoryChangeSet(scope, {
      id: "reg-change-001",
      sourceId: source.id,
      newSnapshotId: snapshot.id,
      changeType: "created",
      changeSummary: "최고금리 표시 기준이 신설되었습니다.",
      changedSections: [
        {
          sectionId: "section-001",
          sectionNumber: "제1조",
          title: "최고금리 표시",
          newText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
          diffSummary: "신설 조항입니다.",
          citation: { snapshotId: snapshot.id, sectionId: "section-001" }
        }
      ],
      effectiveFrom: "2026-07-01",
      riskImpactLevel: "high",
      interpretationSummary: "예금 최고금리 단독 강조를 제한합니다.",
      mappedProductTypes: ["deposit"],
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"],
      qualityGateStatus: "passed",
      confidence: 0.93
    });

    await store.replaceQualityGateResults(scope, changeSet.id, [
      {
        id: "gate-reg-change-001-citation_coverage",
        changeSetId: changeSet.id,
        gateType: "citation_coverage",
        status: "passed",
        summary: "모든 변경 섹션에 원문 citation이 있습니다.",
        evidence: {},
        createdAt: "2026-05-31T00:00:00.000Z"
      }
    ]);
    const activation = await store.activateRegulatoryChangeSet(scope, {
      changeSetId: changeSet.id,
      document: {
        id: "knowledge-auto-reg-change-001",
        documentType: "internal_policy",
        productType: "deposit",
        title: "예금 광고 내부 기준",
        version: "2026.07",
        effectiveFrom: "2026-07-01",
        storageKey: "generated/regulatory/reg-change-001.md",
        canonicalKey: "internal-policy:deposit-ad",
        sourceSnapshotId: snapshot.id,
        changeSetId: changeSet.id,
        autoIngested: true,
        interpretationSummary: "예금 최고금리 단독 강조를 제한합니다."
      },
      chunks: [
        {
          id: "chunk-auto-reg-change-001-001",
          tenantId: scope.tenantId,
          knowledgeDocumentId: "knowledge-auto-reg-change-001",
          chunkText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
          chunkSummary: "최고금리 표시 기준",
          embeddingModel: "deterministic",
          embeddingId: "embedding-auto-reg-change-001-001",
          section: "최고금리 표시",
          metadata: { source: "regulatory_change_set" },
          canonicalSectionKey: "internal-policy:deposit-ad:section-001",
          sectionNumber: "제1조",
          changeSetId: changeSet.id,
          chunkStatus: "active",
          impactTags: ["deposit", "rate_display"],
          effectiveFrom: "2026-07-01",
          sourceReliability: 0.95
        }
      ]
    });

    const evidence = await store.searchKnowledgeEvidence(scope, {
      query: "최고금리 기본금리 우대조건",
      productType: "deposit",
      effectiveOn: "2026-07-02",
      minScore: 0.6
    });

    expect(activation?.document).toMatchObject({
      id: "knowledge-auto-reg-change-001",
      approvalStatus: "approved",
      lifecycleStatus: "active",
      autoIngested: true
    });
    expect(evidence[0]).toMatchObject({
      documentId: "knowledge-auto-reg-change-001",
      chunkId: "chunk-auto-reg-change-001-001",
      title: "예금 광고 내부 기준",
      effectiveFrom: "2026-07-01"
    });
  });

  it("excludes active chunks that are not effective for the planned publish date", async () => {
    const store = createMockReviewStore([]);
    const document = await store.createKnowledgeDocument(scope, {
      id: "knowledge-future",
      documentType: "internal_policy",
      title: "미래 시행 기준",
      version: "2026.07",
      effectiveFrom: "2026-07-01",
      storageKey: "generated/future.md"
    });

    await store.approveKnowledgeDocument(scope, document.id);
    await store.replaceKnowledgeDocumentChunks(scope, document.id, [
      {
        id: "chunk-future-001",
        tenantId: scope.tenantId,
        knowledgeDocumentId: document.id,
        chunkText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
        chunkSummary: "최고금리 표시 기준",
        embeddingModel: "deterministic",
        embeddingId: "embedding-future-001",
        metadata: { source: "knowledge_document" },
        chunkStatus: "active",
        effectiveFrom: "2026-07-01"
      }
    ]);

    const beforeEffectiveDate = await store.searchKnowledgeEvidence(scope, {
      query: "최고금리 기본금리 우대조건",
      effectiveOn: "2026-06-30",
      minScore: 0.6
    });

    expect(beforeEffectiveDate).toEqual([]);
  });
});
```

- [ ] **Step 2: Extend `ReviewStore` contracts**

In `src/server/reviews/review-store.ts`, import the new types from `@/domain/types` and add:

```ts
export type CreateRegulatorySourceInput = Omit<
  RegulatorySource,
  "tenantId" | "createdAt" | "updatedAt" | "lastCheckedAt" | "status"
> & {
  id?: string;
  status?: RegulatorySource["status"];
};

export type CreateRegulatorySnapshotInput = Omit<
  RegulatorySnapshot,
  "tenantId" | "createdAt"
> & {
  id?: string;
};

export type CreateRegulatoryChangeSetInput = Omit<
  RegulatoryChangeSet,
  "tenantId" | "createdAt" | "createdKnowledgeDocumentId"
> & {
  id?: string;
};

export type ActivateRegulatoryChangeSetInput = {
  changeSetId: string;
  document: CreateKnowledgeDocumentInput &
    Pick<
      KnowledgeDocument,
      | "canonicalKey"
      | "sourceSnapshotId"
      | "changeSetId"
      | "supersedesDocumentId"
      | "autoIngested"
      | "sourcePublishedAt"
      | "interpretationSummary"
    >;
  chunks: Array<
    CreateKnowledgeDocumentChunkInput &
      Pick<
        EvidenceChunk,
        | "canonicalSectionKey"
        | "sectionNumber"
        | "changeSetId"
        | "supersedesChunkId"
        | "chunkStatus"
        | "impactTags"
        | "effectiveFrom"
        | "effectiveTo"
        | "sourceReliability"
      >
  >;
};

export type RegulatoryChangeSetListOptions = {
  sourceId?: string;
  qualityGateStatus?: QualityGateStatus;
};
```

Add `effectiveOn?: string` to `KnowledgeEvidenceSearchInput`.

Add methods to `ReviewStore`:

```ts
  createRegulatorySource(
    scope: ReviewStoreScope,
    input: CreateRegulatorySourceInput
  ): Promise<RegulatorySource>;
  listRegulatorySources(scope: ReviewStoreScope): Promise<RegulatorySource[]>;
  getRegulatorySource(
    scope: ReviewStoreScope,
    sourceId: string
  ): Promise<RegulatorySource | undefined>;
  createRegulatorySnapshot(
    scope: ReviewStoreScope,
    input: CreateRegulatorySnapshotInput
  ): Promise<RegulatorySnapshot>;
  getLatestRegulatorySnapshot(
    scope: ReviewStoreScope,
    sourceId: string
  ): Promise<RegulatorySnapshot | undefined>;
  createRegulatoryChangeSet(
    scope: ReviewStoreScope,
    input: CreateRegulatoryChangeSetInput
  ): Promise<RegulatoryChangeSet>;
  listRegulatoryChangeSets(
    scope: ReviewStoreScope,
    options?: RegulatoryChangeSetListOptions
  ): Promise<RegulatoryChangeSet[]>;
  getRegulatoryChangeSet(
    scope: ReviewStoreScope,
    changeSetId: string
  ): Promise<RegulatoryChangeSet | undefined>;
  replaceQualityGateResults(
    scope: ReviewStoreScope,
    changeSetId: string,
    results: QualityGateResult[]
  ): Promise<QualityGateResult[] | undefined>;
  listQualityGateResults(
    scope: ReviewStoreScope,
    changeSetId: string
  ): Promise<QualityGateResult[] | undefined>;
  activateRegulatoryChangeSet(
    scope: ReviewStoreScope,
    input: ActivateRegulatoryChangeSetInput
  ): Promise<
    | {
        changeSet: RegulatoryChangeSet;
        document: KnowledgeDocument;
        chunks: EvidenceChunk[];
      }
    | undefined
  >;
```

- [ ] **Step 3: Implement mock store data maps and methods**

In `createMockReviewStore`, add maps:

```ts
  let regulatorySourceSequence = 1;
  let regulatorySnapshotSequence = 1;
  let regulatoryChangeSetSequence = 1;
  const regulatorySources = new Map<string, RegulatorySource>();
  const regulatorySnapshots = new Map<string, RegulatorySnapshot>();
  const regulatoryChangeSets = new Map<string, RegulatoryChangeSet>();
  const qualityGateResults = new Map<string, QualityGateResult[]>();
```

Add helper functions:

```ts
  function canAccessRegulatorySource(scope: ReviewStoreScope, sourceId: string): boolean {
    return regulatorySources.get(sourceId)?.tenantId === scope.tenantId;
  }

  function activeChunkForSearch(chunk: EvidenceChunk, input: KnowledgeEvidenceSearchInput): boolean {
    if (chunk.chunkStatus && chunk.chunkStatus !== "active") {
      return false;
    }

    if (input.effectiveOn) {
      const effectiveFrom = chunk.effectiveFrom;
      const effectiveTo = chunk.effectiveTo;

      if (effectiveFrom && input.effectiveOn < effectiveFrom) {
        return false;
      }

      if (effectiveTo && input.effectiveOn > effectiveTo) {
        return false;
      }
    }

    return true;
  }
```

Update `matchesKnowledgeSearch` so inactive/superseded documents do not match:

```ts
      document.approvalStatus === "approved" &&
      (!document.lifecycleStatus || document.lifecycleStatus === "active") &&
```

In `searchKnowledgeEvidence`, before scoring, add:

```ts
          if (!activeChunkForSearch(chunk, input)) {
            return [];
          }
```

Add the new regulatory methods to `store`. Use deterministic ids:

```ts
    async createRegulatorySource(scope, input) {
      const now = nowIso();
      const id = input.id ?? `reg-source-${String(regulatorySourceSequence).padStart(3, "0")}`;
      regulatorySourceSequence += input.id ? 0 : 1;
      const source: RegulatorySource = {
        id,
        tenantId: scope.tenantId,
        sourceType: input.sourceType,
        name: input.name,
        url: input.url,
        repositoryPath: input.repositoryPath,
        pollingSchedule: input.pollingSchedule,
        trustLevel: input.trustLevel,
        status: input.status ?? "active",
        createdAt: now,
        updatedAt: now
      };
      regulatorySources.set(id, source);

      return clone(source);
    },

    async listRegulatorySources(scope) {
      return clone(
        Array.from(regulatorySources.values()).filter((source) => source.tenantId === scope.tenantId)
      );
    },

    async getRegulatorySource(scope, sourceId) {
      const source = regulatorySources.get(sourceId);

      return source && source.tenantId === scope.tenantId ? clone(source) : undefined;
    },

    async createRegulatorySnapshot(scope, input) {
      if (!canAccessRegulatorySource(scope, input.sourceId)) {
        throw new Error("Regulatory source not found");
      }

      const id = input.id ?? `reg-snapshot-${String(regulatorySnapshotSequence).padStart(3, "0")}`;
      regulatorySnapshotSequence += input.id ? 0 : 1;
      const snapshot: RegulatorySnapshot = {
        ...input,
        id,
        tenantId: scope.tenantId,
        createdAt: nowIso()
      };
      regulatorySnapshots.set(id, snapshot);
      const source = regulatorySources.get(input.sourceId);

      if (source) {
        regulatorySources.set(source.id, {
          ...source,
          lastCheckedAt: snapshot.createdAt,
          status: input.fetchStatus === "failed" ? "failing" : source.status,
          updatedAt: snapshot.createdAt
        });
      }

      return clone(snapshot);
    },

    async getLatestRegulatorySnapshot(scope, sourceId) {
      if (!canAccessRegulatorySource(scope, sourceId)) {
        return undefined;
      }

      return clone(
        Array.from(regulatorySnapshots.values())
          .filter((snapshot) => snapshot.tenantId === scope.tenantId && snapshot.sourceId === sourceId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      );
    },

    async createRegulatoryChangeSet(scope, input) {
      if (!canAccessRegulatorySource(scope, input.sourceId)) {
        throw new Error("Regulatory source not found");
      }

      const id = input.id ?? `reg-change-${String(regulatoryChangeSetSequence).padStart(3, "0")}`;
      regulatoryChangeSetSequence += input.id ? 0 : 1;
      const changeSet: RegulatoryChangeSet = {
        ...input,
        id,
        tenantId: scope.tenantId,
        createdAt: nowIso()
      };
      regulatoryChangeSets.set(id, changeSet);

      return clone(changeSet);
    },
```

Add the remaining mock methods:

```ts
    async listRegulatoryChangeSets(scope, options = {}) {
      return clone(
        Array.from(regulatoryChangeSets.values())
          .filter((changeSet) => changeSet.tenantId === scope.tenantId)
          .filter((changeSet) => !options.sourceId || changeSet.sourceId === options.sourceId)
          .filter(
            (changeSet) =>
              !options.qualityGateStatus ||
              changeSet.qualityGateStatus === options.qualityGateStatus
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
    },

    async getRegulatoryChangeSet(scope, changeSetId) {
      const changeSet = regulatoryChangeSets.get(changeSetId);

      return changeSet && changeSet.tenantId === scope.tenantId ? clone(changeSet) : undefined;
    },

    async replaceQualityGateResults(scope, changeSetId, results) {
      const changeSet = regulatoryChangeSets.get(changeSetId);

      if (!changeSet || changeSet.tenantId !== scope.tenantId) {
        return undefined;
      }

      qualityGateResults.set(changeSetId, clone(results));

      return clone(results);
    },

    async listQualityGateResults(scope, changeSetId) {
      const changeSet = regulatoryChangeSets.get(changeSetId);

      if (!changeSet || changeSet.tenantId !== scope.tenantId) {
        return undefined;
      }

      return clone(qualityGateResults.get(changeSetId) ?? []);
    },

    async activateRegulatoryChangeSet(scope, input) {
      const changeSet = regulatoryChangeSets.get(input.changeSetId);

      if (!changeSet || changeSet.tenantId !== scope.tenantId) {
        return undefined;
      }

      if (input.document.canonicalKey) {
        for (const [documentId, document] of knowledgeDocuments) {
          if (
            document.tenantId === scope.tenantId &&
            document.canonicalKey === input.document.canonicalKey &&
            (!document.lifecycleStatus || document.lifecycleStatus === "active")
          ) {
            knowledgeDocuments.set(documentId, {
              ...document,
              lifecycleStatus: "superseded"
            });
          }
        }
      }

      const document: KnowledgeDocument = {
        id: input.document.id ?? `knowledge-${String(knowledgeSequence).padStart(3, "0")}`,
        tenantId: scope.tenantId,
        affiliateId: validAffiliateId(scope, input.document.affiliateId),
        documentType: input.document.documentType,
        productType: input.document.productType,
        title: input.document.title,
        version: input.document.version,
        effectiveFrom: input.document.effectiveFrom,
        approvalStatus: "approved",
        storageKey: input.document.storageKey,
        createdBy: scope.actorUserId,
        approvedBy: scope.actorUserId,
        createdAt: nowIso(),
        approvedAt: nowIso(),
        canonicalKey: input.document.canonicalKey,
        sourceSnapshotId: input.document.sourceSnapshotId,
        changeSetId: input.document.changeSetId,
        supersedesDocumentId: input.document.supersedesDocumentId,
        lifecycleStatus: "active",
        autoIngested: input.document.autoIngested ?? true,
        sourcePublishedAt: input.document.sourcePublishedAt,
        interpretationSummary: input.document.interpretationSummary
      };
      knowledgeDocuments.set(document.id, document);

      const persistedChunks = input.chunks.map<EvidenceChunk>((chunk) => ({
        ...chunk,
        tenantId: scope.tenantId,
        knowledgeDocumentId: document.id,
        chunkStatus: chunk.chunkStatus ?? "active",
        metadata: clone(chunk.metadata),
        createdAt: nowIso()
      }));

      for (const chunk of persistedChunks) {
        evidenceChunks.set(chunk.id, chunk);
      }

      const updatedChangeSet: RegulatoryChangeSet = {
        ...changeSet,
        createdKnowledgeDocumentId: document.id
      };
      regulatoryChangeSets.set(changeSet.id, updatedChangeSet);

      return {
        changeSet: clone(updatedChangeSet),
        document: clone(document),
        chunks: clone(persistedChunks)
      };
    },
```

- [ ] **Step 4: Run the mock-store regulatory tests**

Run: `npm run test -- src/server/reviews/mock-review-store.regulatory.test.ts`

Expected: PASS.

- [ ] **Step 5: Run existing knowledge search test**

Run: `npm run test -- src/server/reviews/mock-review-store.knowledge-search.test.ts`

Expected: PASS. Existing manually approved knowledge should still be searchable because undefined lifecycle/chunk statuses are treated as active.

- [ ] **Step 6: Commit**

```bash
git add src/server/reviews/review-store.ts src/server/reviews/mock-review-store.ts src/server/reviews/mock-review-store.regulatory.test.ts
git commit -m "feat: add regulatory mock store persistence"
```

---

### Task 6: Prisma Store Regulatory Persistence

**Files:**
- Modify: `src/server/reviews/prisma-review-store.ts`
- Modify: `src/server/reviews/prisma-mappers.test.ts`
- Modify: `src/server/reviews/prisma-review-store.integration.test.ts`

- [ ] **Step 1: Add mapper coverage for extended knowledge fields**

In `src/server/reviews/prisma-mappers.test.ts`, add a test that builds a Prisma-like knowledge document row with regulatory fields and asserts the mapped domain object includes:

```ts
expect(document).toMatchObject({
  canonicalKey: "internal-policy:deposit-ad",
  sourceSnapshotId: "reg-snapshot-202607",
  changeSetId: "reg-change-001",
  lifecycleStatus: "active",
  autoIngested: true,
  sourcePublishedAt: "2026-06-15",
  interpretationSummary: "예금 최고금리 단독 강조를 제한합니다."
});
```

If `toKnowledgeDocument` remains local to `prisma-review-store.ts`, move it into `src/server/reviews/prisma-mappers.ts` and import it from the store. Keep the existing mapper tests passing.

- [ ] **Step 2: Run mapper tests and verify failure**

Run: `npm run test -- src/server/reviews/prisma-mappers.test.ts`

Expected: FAIL until mapper functions include regulatory fields.

- [ ] **Step 3: Extend Prisma row mappers**

Update `toKnowledgeDocument` to include:

```ts
    canonicalKey: row.canonicalKey ?? undefined,
    sourceSnapshotId: row.sourceSnapshotId ?? undefined,
    changeSetId: row.changeSetId ?? undefined,
    supersedesDocumentId: row.supersedesDocumentId ?? undefined,
    lifecycleStatus: row.lifecycleStatus,
    autoIngested: row.autoIngested,
    sourcePublishedAt: row.sourcePublishedAt ? dateOnlyString(row.sourcePublishedAt) : undefined,
    interpretationSummary: row.interpretationSummary ?? undefined,
```

Update `toEvidenceChunk` to include:

```ts
    canonicalSectionKey: row.canonicalSectionKey ?? undefined,
    sectionNumber: row.sectionNumber ?? undefined,
    changeSetId: row.changeSetId ?? undefined,
    supersedesChunkId: row.supersedesChunkId ?? undefined,
    chunkStatus: row.chunkStatus,
    impactTags: jsonStringArray(row.impactTags),
    effectiveFrom: row.effectiveFrom ? dateOnlyString(row.effectiveFrom) : undefined,
    effectiveTo: row.effectiveTo ? dateOnlyString(row.effectiveTo) : undefined,
    sourceReliability: row.sourceReliability ?? undefined,
```

- [ ] **Step 4: Implement Prisma regulatory methods**

In `src/server/reviews/prisma-review-store.ts`, add mapper functions:

```ts
function toRegulatorySource(row: {
  id: string;
  tenantId: string;
  sourceType: RegulatorySource["sourceType"];
  name: string;
  url: string | null;
  repositoryPath: string | null;
  pollingSchedule: string;
  trustLevel: RegulatorySource["trustLevel"];
  lastCheckedAt: Date | null;
  status: RegulatorySource["status"];
  createdAt: Date;
  updatedAt: Date;
}): RegulatorySource {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceType: row.sourceType,
    name: row.name,
    url: row.url ?? undefined,
    repositoryPath: row.repositoryPath ?? undefined,
    pollingSchedule: row.pollingSchedule,
    trustLevel: row.trustLevel,
    lastCheckedAt: row.lastCheckedAt?.toISOString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
```

Add equivalent mappers for `RegulatorySnapshot`, `RegulatoryChangeSet`, and `QualityGateResult`. Use `jsonStringArray` for mapped products/channels/categories and cast `changedSections` as `RegulatoryChangedSection[]`.

Add Prisma implementations for every regulatory `ReviewStore` method from Task 5. In `activateRegulatoryChangeSet`, use a transaction to:

1. Load the change set by tenant.
2. Supersede the previous active document with the same `canonicalKey` when `input.document.canonicalKey` is present.
3. Create the new `knowledgeDocument` with `approvalStatus: "approved"`, `lifecycleStatus: "active"`, and `autoIngested: true`.
4. Create provided evidence chunks with regulatory fields.
5. Update `createdKnowledgeDocumentId` and `qualityGateStatus`.
6. Return mapped `{ changeSet, document, chunks }`.

- [ ] **Step 5: Add env-gated integration test**

In `src/server/reviews/prisma-review-store.integration.test.ts`, add:

```ts
  it("persists regulatory sources, change sets, gates, and active knowledge", async () => {
    const store = createPrismaReviewStore();
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-integration",
      sourceType: "internal_policy_repo",
      name: "통합 테스트 예금 기준",
      repositoryPath: "internal/test/deposit.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });
    const snapshot = await store.createRegulatorySnapshot(scope, {
      id: "reg-snapshot-integration",
      sourceId: source.id,
      title: "통합 테스트 예금 기준",
      effectiveFrom: "2026-07-01",
      contentHash: `hash-${Date.now()}`,
      rawStorageKey: "regulatory/raw/integration.txt",
      normalizedStorageKey: "regulatory/normalized/integration.json",
      detectedDocumentType: "internal_policy",
      fetchStatus: "fetched",
      normalizationConfidence: 0.96
    });
    const changeSet = await store.createRegulatoryChangeSet(scope, {
      id: "reg-change-integration",
      sourceId: source.id,
      newSnapshotId: snapshot.id,
      changeType: "created",
      changeSummary: "통합 테스트 변경",
      changedSections: [
        {
          sectionId: "section-001",
          title: "최고금리 표시",
          newText: "최고금리 표현 시 조건을 인접 표시한다.",
          diffSummary: "신설 조항입니다.",
          citation: { snapshotId: snapshot.id, sectionId: "section-001" }
        }
      ],
      effectiveFrom: "2026-07-01",
      riskImpactLevel: "high",
      interpretationSummary: "최고금리 표시 조건을 강화합니다.",
      mappedProductTypes: ["deposit"],
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"],
      qualityGateStatus: "passed",
      confidence: 0.91
    });
    const activation = await store.activateRegulatoryChangeSet(scope, {
      changeSetId: changeSet.id,
      document: {
        id: "knowledge-reg-integration",
        documentType: "internal_policy",
        productType: "deposit",
        title: "통합 테스트 예금 기준",
        version: "2026.07",
        effectiveFrom: "2026-07-01",
        storageKey: "generated/regulatory/integration.md",
        canonicalKey: "integration:deposit",
        sourceSnapshotId: snapshot.id,
        changeSetId: changeSet.id,
        autoIngested: true,
        interpretationSummary: "최고금리 표시 조건을 강화합니다."
      },
      chunks: [
        {
          id: "chunk-reg-integration-001",
          tenantId: scope.tenantId,
          knowledgeDocumentId: "knowledge-reg-integration",
          chunkText: "최고금리 표현 시 조건을 인접 표시한다.",
          chunkSummary: "최고금리 표시 조건",
          embeddingModel: "deterministic",
          embeddingId: "embedding-reg-integration-001",
          metadata: { source: "regulatory_change_set" },
          chunkStatus: "active",
          effectiveFrom: "2026-07-01",
          impactTags: ["deposit", "rate_display"]
        }
      ]
    });

    expect(activation?.document).toMatchObject({
      id: "knowledge-reg-integration",
      approvalStatus: "approved",
      lifecycleStatus: "active",
      autoIngested: true
    });
  });
```

- [ ] **Step 6: Run Prisma-related tests**

Run: `npm run test -- src/server/reviews/prisma-mappers.test.ts src/server/reviews/prisma-review-store.integration.test.ts`

Expected: mapper test PASS. Integration test PASS when `TEST_DATABASE_URL` or `DATABASE_URL` is configured, otherwise SKIP.

- [ ] **Step 7: Commit**

```bash
git add src/server/reviews/prisma-review-store.ts src/server/reviews/prisma-mappers.ts src/server/reviews/prisma-mappers.test.ts src/server/reviews/prisma-review-store.integration.test.ts
git commit -m "feat: persist regulatory knowledge in prisma store"
```

---

### Task 7: Regulatory Knowledge Service

**Files:**
- Create: `src/server/regulatory/regulatory-knowledge-service.ts`
- Create: `src/server/regulatory/regulatory-knowledge-service.test.ts`

- [ ] **Step 1: Write service failing test**

Create `src/server/regulatory/regulatory-knowledge-service.test.ts`:

```ts
import { createMockReviewStore } from "@/server/reviews/mock-review-store";
import { createRegulatoryKnowledgeService } from "./regulatory-knowledge-service";

const context = {
  tenantId: "tenant-demo",
  userId: "user-reviewer-demo",
  role: "reviewer" as const,
  ipAddress: "127.0.0.1"
};

describe("regulatory knowledge service", () => {
  it("detects a changed source and activates active RAG knowledge", async () => {
    const store = createMockReviewStore([]);
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date("2026-05-31T00:00:00.000Z")
    });
    const source = await store.createRegulatorySource(
      {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorRole: context.role,
        ipAddress: context.ipAddress
      },
      {
        id: "reg-source-deposit-policy",
        sourceType: "internal_policy_repo",
        name: "예금 광고 내부 기준",
        repositoryPath: "internal/policies/deposit-ad.md",
        pollingSchedule: "0 9 * * *",
        trustLevel: "internal"
      }
    );

    const result = await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "예금 광고 내부 기준",
      version: "2026.07",
      sourceText: [
        "제1조 최고금리 표시",
        "최고금리 표현 시 기본금리, 우대조건, 적용 한도를 인접 영역에 표시해야 한다."
      ].join("\n"),
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"]
    });

    expect(result).toMatchObject({
      sourceId: source.id,
      snapshotCreated: true,
      activated: true,
      changeSetCount: 1,
      activatedDocumentIds: ["knowledge-auto-reg-change-001"]
    });
    const evidence = await store.searchKnowledgeEvidence(
      {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorRole: context.role
      },
      {
        query: "최고금리 기본금리 우대조건",
        productType: "deposit",
        effectiveOn: "2026-07-01",
        minScore: 0.6
      }
    );

    expect(evidence[0]).toMatchObject({
      title: "예금 광고 내부 기준",
      effectiveFrom: "2026-07-01"
    });
  });
});
```

- [ ] **Step 2: Implement service orchestration**

Create `src/server/regulatory/regulatory-knowledge-service.ts` with:

```ts
import { createHash } from "node:crypto";
import type { KnowledgeDocumentType, ProductType, RegulatoryChangeSet } from "@/domain/types";
import { createKnowledgeDocumentChunks } from "@/server/knowledge/knowledge-ingestion";
import { getReviewStore } from "@/server/reviews";
import type { ReviewStore, ReviewStoreScope } from "@/server/reviews/review-store";
import type { RequestContext } from "@/server/auth/request-context";
import { detectRegulatoryChanges } from "./change-diff";
import { normalizeRegulatoryText } from "./normalizer";
import { qualityGateStatus, runRegulatoryQualityGates } from "./quality-gates";

type RegulatoryKnowledgeServiceDeps = {
  store?: ReviewStore;
  now?: () => Date;
};

type RunSourceCheckInput = {
  sourceId: string;
  title: string;
  version: string;
  sourceText: string;
  effectiveFrom?: string;
  documentType: KnowledgeDocumentType;
  productType?: ProductType;
  mappedChannels?: string[];
  mappedReviewCategories?: string[];
};

type RunSourceCheckResult = {
  sourceId: string;
  snapshotCreated: boolean;
  activated: boolean;
  changeSetCount: number;
  activatedDocumentIds: string[];
};

function scopeFromContext(context: RequestContext): ReviewStoreScope {
  return {
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorRole: context.role,
    ipAddress: context.ipAddress
  };
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function impactSummary(changeSet: Pick<RegulatoryChangeSet, "changedSections">): string {
  return changeSet.changedSections
    .map((section) => section.newText ?? section.previousText ?? section.title)
    .join(" ");
}

function riskImpactLevel(text: string): RegulatoryChangeSet["riskImpactLevel"] {
  return /최고금리|보장|필수|제한|금지/.test(text) ? "high" : "caution";
}

export function createRegulatoryKnowledgeService({
  store = getReviewStore(),
  now = () => new Date()
}: RegulatoryKnowledgeServiceDeps = {}) {
  return {
    async runSourceCheck(
      context: RequestContext,
      input: RunSourceCheckInput
    ): Promise<RunSourceCheckResult> {
      const scope = scopeFromContext(context);
      const source = await store.getRegulatorySource(scope, input.sourceId);

      if (!source) {
        throw new Error("Regulatory source not found");
      }

      const hash = contentHash(input.sourceText);
      const previousSnapshot = await store.getLatestRegulatorySnapshot(scope, input.sourceId);

      if (previousSnapshot?.contentHash === hash) {
        await store.recordAuditEvent(scope, {
          action: "regulatory_source.checked",
          targetType: "regulatory_source",
          targetId: input.sourceId,
          afterValue: { unchanged: true, contentHash: hash }
        });

        return {
          sourceId: input.sourceId,
          snapshotCreated: false,
          activated: false,
          changeSetCount: 0,
          activatedDocumentIds: []
        };
      }

      const snapshotId = `reg-snapshot-${now().toISOString().slice(0, 10).replaceAll("-", "")}`;
      const snapshot = await store.createRegulatorySnapshot(scope, {
        id: snapshotId,
        sourceId: input.sourceId,
        sourceUrl: source.url,
        title: input.title,
        effectiveFrom: input.effectiveFrom,
        contentHash: hash,
        rawStorageKey: `regulatory/raw/${snapshotId}.txt`,
        normalizedStorageKey: `regulatory/normalized/${snapshotId}.json`,
        detectedDocumentType: input.documentType,
        fetchStatus: "fetched",
        normalizationConfidence: 0.96
      });
      await store.recordAuditEvent(scope, {
        action: "regulatory_snapshot.created",
        targetType: "regulatory_snapshot",
        targetId: snapshot.id,
        afterValue: { sourceId: source.id, contentHash: hash }
      });

      const previousSections = previousSnapshot
        ? normalizeRegulatoryText({
            snapshotId: previousSnapshot.id,
            text: ""
          })
        : [];
      const nextSections = normalizeRegulatoryText({
        snapshotId: snapshot.id,
        text: input.sourceText
      });
      const detectedChanges = detectRegulatoryChanges({
        previousSnapshotId: previousSnapshot?.id,
        newSnapshotId: snapshot.id,
        previous: previousSections,
        next: nextSections
      });
      const activatedDocumentIds: string[] = [];

      for (const [index, detectedChange] of detectedChanges.entries()) {
        const sequence = String(index + 1).padStart(3, "0");
        const summaryText = impactSummary({ changedSections: detectedChange.changedSections });
        const changeSetId = `reg-change-${sequence}`;
        const changeSet = await store.createRegulatoryChangeSet(scope, {
          id: changeSetId,
          sourceId: source.id,
          previousSnapshotId: previousSnapshot?.id,
          newSnapshotId: snapshot.id,
          changeType: detectedChange.changeType,
          changeSummary: `${input.title} 변경: ${detectedChange.changedSections[0]?.title ?? "본문"}`,
          changedSections: detectedChange.changedSections,
          effectiveFrom: input.effectiveFrom,
          riskImpactLevel: riskImpactLevel(summaryText),
          interpretationSummary: `${input.title} 변경분은 광고 심의 지식베이스에 자동 반영됩니다.`,
          mappedProductTypes: input.productType ? [input.productType] : [],
          mappedChannels: input.mappedChannels ?? [],
          mappedReviewCategories: input.mappedReviewCategories ?? [],
          qualityGateStatus: "passed",
          confidence: 0.9
        });
        const chunks = await createKnowledgeDocumentChunks({
          tenantId: scope.tenantId,
          documentId: `knowledge-auto-${changeSet.id}`,
          text: summaryText,
          now
        });
        const gateResults = runRegulatoryQualityGates({
          changeSet,
          regressionRetrieved: chunks.length > 0,
          rollbackTargetReady: true,
          now
        });
        await store.replaceQualityGateResults(scope, changeSet.id, gateResults);
        const gateStatus = qualityGateStatus(gateResults);

        await store.recordAuditEvent(scope, {
          action:
            gateStatus === "failed"
              ? "regulatory_change.quality_gate_failed"
              : "regulatory_change.quality_gate_passed",
          targetType: "regulatory_change_set",
          targetId: changeSet.id,
          afterValue: { gateStatus }
        });

        if (gateStatus === "failed") {
          continue;
        }

        const activation = await store.activateRegulatoryChangeSet(scope, {
          changeSetId: changeSet.id,
          document: {
            id: `knowledge-auto-${changeSet.id}`,
            documentType: input.documentType,
            productType: input.productType,
            title: input.title,
            version: input.version,
            effectiveFrom: input.effectiveFrom ?? now().toISOString().slice(0, 10),
            storageKey: `generated/regulatory/${changeSet.id}.md`,
            canonicalKey: `${source.sourceType}:${source.id}`,
            sourceSnapshotId: snapshot.id,
            changeSetId: changeSet.id,
            autoIngested: true,
            interpretationSummary: changeSet.interpretationSummary
          },
          chunks: chunks.map((chunk, chunkIndex) => ({
            ...chunk,
            canonicalSectionKey: `${source.id}:${detectedChange.changedSections[chunkIndex]?.sectionId ?? chunk.id}`,
            sectionNumber: detectedChange.changedSections[chunkIndex]?.sectionNumber,
            changeSetId: changeSet.id,
            chunkStatus: "active",
            impactTags: [
              ...changeSet.mappedProductTypes,
              ...changeSet.mappedChannels,
              ...changeSet.mappedReviewCategories
            ],
            effectiveFrom: input.effectiveFrom,
            sourceReliability: 0.95
          }))
        });

        if (activation) {
          activatedDocumentIds.push(activation.document.id);
          await store.recordAuditEvent(scope, {
            action: "knowledge_document.auto_versioned",
            targetType: "knowledge_document",
            targetId: activation.document.id,
            afterValue: {
              changeSetId: changeSet.id,
              chunkCount: activation.chunks.length
            }
          });
        }
      }

      return {
        sourceId: source.id,
        snapshotCreated: true,
        activated: activatedDocumentIds.length > 0,
        changeSetCount: detectedChanges.length,
        activatedDocumentIds
      };
    }
  };
}
```

- [ ] **Step 3: Fix previous snapshot normalization**

The service code above intentionally leaves previous normalized text unavailable because snapshots currently store only storage keys. Before committing, add `normalizedText?: string` to the `RunSourceCheckInput` and snapshot metadata path used in tests, or add a store method that retrieves normalized text bodies. For this MVP, prefer the smaller change: include `previousNormalizedText?: string` in `RunSourceCheckInput` and use that when comparing against the latest snapshot:

```ts
      const previousSections =
        previousSnapshot && input.previousNormalizedText
          ? normalizeRegulatoryText({
              snapshotId: previousSnapshot.id,
              text: input.previousNormalizedText
            })
          : [];
```

Update the `RunSourceCheckInput` type accordingly. This preserves deterministic tests and keeps object storage retrieval out of the first service slice.

- [ ] **Step 4: Run service tests**

Run: `npm run test -- src/server/regulatory/regulatory-knowledge-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/regulatory/regulatory-knowledge-service.ts src/server/regulatory/regulatory-knowledge-service.test.ts
git commit -m "feat: orchestrate regulatory knowledge updates"
```

---

### Task 8: Regulatory API Routes

**Files:**
- Create: `src/app/api/v1/regulatory-sources/route.ts`
- Create: `src/app/api/v1/regulatory-sources/[sourceId]/check/route.ts`
- Create: `src/app/api/v1/regulatory-change-sets/route.ts`
- Create: `src/app/api/v1/regulatory-change-sets/[changeSetId]/route.ts`
- Modify: `src/api/review-api-routes.test.ts`

- [ ] **Step 1: Write route tests**

In `src/api/review-api-routes.test.ts`, add imports:

```ts
import {
  GET as regulatorySourcesGET,
  POST as regulatorySourcesPOST
} from "@/app/api/v1/regulatory-sources/route";
import { POST as regulatorySourceCheckPOST } from "@/app/api/v1/regulatory-sources/[sourceId]/check/route";
import { GET as regulatoryChangeSetsGET } from "@/app/api/v1/regulatory-change-sets/route";
import { GET as regulatoryChangeSetDetailGET } from "@/app/api/v1/regulatory-change-sets/[changeSetId]/route";
```

Add test:

```ts
  it("creates a regulatory source and runs a source check that activates knowledge", async () => {
    const sourceResponse = await regulatorySourcesPOST(
      jsonRoleRequest(
        "/api/v1/regulatory-sources",
        {
          id: "reg-source-route",
          sourceType: "internal_policy_repo",
          name: "라우트 테스트 예금 기준",
          repositoryPath: "internal/route/deposit.md",
          pollingSchedule: "0 9 * * *",
          trustLevel: "internal"
        },
        "reviewer"
      )
    );
    const sourceBody = await sourceResponse.json();

    expect(sourceResponse.status).toBe(201);
    expect(sourceBody.source).toMatchObject({
      id: "reg-source-route",
      name: "라우트 테스트 예금 기준"
    });

    const checkResponse = await regulatorySourceCheckPOST(
      jsonRoleRequest(
        "/api/v1/regulatory-sources/reg-source-route/check",
        {
          title: "라우트 테스트 예금 기준",
          version: "2026.07",
          sourceText: "제1조 최고금리 표시\n최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
          effectiveFrom: "2026-07-01",
          documentType: "internal_policy",
          productType: "deposit",
          mappedChannels: ["mobile_banner"],
          mappedReviewCategories: ["rate_display"]
        },
        "reviewer"
      ),
      params({ sourceId: "reg-source-route" })
    );
    const checkBody = await checkResponse.json();

    expect(checkResponse.status).toBe(200);
    expect(checkBody.result).toMatchObject({
      sourceId: "reg-source-route",
      snapshotCreated: true,
      activated: true,
      changeSetCount: 1
    });

    const changeListResponse = await regulatoryChangeSetsGET(
      new Request("http://localhost/api/v1/regulatory-change-sets")
    );
    const changeListBody = await changeListResponse.json();

    expect(changeListBody.changeSets[0]).toMatchObject({
      sourceId: "reg-source-route",
      mappedProductTypes: ["deposit"]
    });

    const detailResponse = await regulatoryChangeSetDetailGET(
      new Request("http://localhost/api/v1/regulatory-change-sets/reg-change-001"),
      params({ changeSetId: "reg-change-001" })
    );
    const detailBody = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailBody.qualityGateResults.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Implement source list/create route**

Create `src/app/api/v1/regulatory-sources/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { RegulatorySourceType } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, jsonForbidden, readJsonBody, requestContext } from "@/server/reviews/route-utils";

type CreateSourceBody = {
  id?: unknown;
  sourceType?: unknown;
  name?: unknown;
  url?: unknown;
  repositoryPath?: unknown;
  pollingSchedule?: unknown;
  trustLevel?: unknown;
};

export async function GET(request = new Request("http://localhost/api/v1/regulatory-sources")) {
  try {
    const sources = await createReviewService().listRegulatorySources(await requestContext(request));

    return NextResponse.json({ sources });
  } catch (error) {
    return jsonForbidden(error);
  }
}

export async function POST(request: Request) {
  const body = await readJsonBody<CreateSourceBody>(request);
  const sourceType = parseSourceType(body?.sourceType);
  const name = parseString(body?.name);
  const trustLevel = parseTrustLevel(body?.trustLevel);

  if (!sourceType) {
    return jsonError("sourceType is invalid", 400);
  }

  if (!name) {
    return jsonError("name is required", 400);
  }

  if (!trustLevel) {
    return jsonError("trustLevel is invalid", 400);
  }

  try {
    const source = await createReviewService().createRegulatorySource(await requestContext(request), {
      id: parseString(body?.id),
      sourceType,
      name,
      url: parseString(body?.url),
      repositoryPath: parseString(body?.repositoryPath),
      pollingSchedule: parseString(body?.pollingSchedule) ?? "0 9 * * *",
      trustLevel
    });

    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    return jsonForbidden(error);
  }
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseSourceType(value: unknown): RegulatorySourceType | undefined {
  if (
    value === "regulator" ||
    value === "law_portal" ||
    value === "association" ||
    value === "internal_policy_repo" ||
    value === "case_knowledge"
  ) {
    return value;
  }

  return undefined;
}

function parseTrustLevel(value: unknown) {
  if (value === "official" || value === "industry" || value === "internal" || value === "reference") {
    return value;
  }

  return undefined;
}
```

Also add pass-through methods to `createReviewService`: `createRegulatorySource`, `listRegulatorySources`, `listRegulatoryChangeSets`, `getRegulatoryChangeSet`, and `listQualityGateResults`. Require `reviewer` or `compliance_admin` for create/check operations.

- [ ] **Step 3: Implement check and change-set routes**

Create the remaining route files. The check route should call:

```ts
const result = await createRegulatoryKnowledgeService().runSourceCheck(await requestContext(request), {
  sourceId,
  title,
  version,
  sourceText,
  effectiveFrom,
  documentType,
  productType,
  mappedChannels,
  mappedReviewCategories
});
```

Change-set list route returns `{ changeSets }`. Detail route returns `{ changeSet, qualityGateResults }` and 404 when the change set is not found.

- [ ] **Step 4: Run route tests**

Run: `npm run test -- src/api/review-api-routes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/regulatory-sources src/app/api/v1/regulatory-change-sets src/api/review-api-routes.test.ts src/server/reviews/review-service.ts
git commit -m "feat: expose regulatory knowledge APIs"
```

---

### Task 9: Review Analysis Uses Active Effective Knowledge

**Files:**
- Modify: `src/server/analysis/review-analysis-pipeline.ts`
- Modify: `src/server/analysis/review-analysis-pipeline.test.ts`
- Modify: `src/server/reviews/prisma-review-store.ts`
- Modify: `src/server/reviews/mock-review-store.ts`

- [ ] **Step 1: Write retrieval behavior test**

In `src/server/analysis/review-analysis-pipeline.test.ts`, add a test with a fake `reviewStore.searchKnowledgeEvidence` spy:

```ts
  it("passes planned publish date to knowledge retrieval", async () => {
    const searchKnowledgeEvidence = vi.fn(async () => []);
    const pipeline = createReviewAnalysisPipeline({
      ocrProvider: {
        extract: async () => [
          {
            fileId: "file-001",
            fileName: "copy.txt",
            text: "최고금리 기본금리 우대조건",
            confidence: 0.96,
            provider: "fixture"
          }
        ]
      },
      reviewStore: {
        searchKnowledgeEvidence
      }
    });

    await pipeline.run({
      review: {
        ...reviewCases[0],
        plannedPublishDate: "2026-07-02",
        productType: "deposit"
      },
      scope: {
        tenantId: "tenant-demo",
        actorUserId: "user-reviewer-demo",
        actorRole: "reviewer"
      }
    });

    expect(searchKnowledgeEvidence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        effectiveOn: "2026-07-02"
      })
    );
  });
```

- [ ] **Step 2: Update pipeline retrieval call**

In `review-analysis-pipeline.ts`, when building the `KnowledgeEvidenceSearchInput`, include:

```ts
effectiveOn: review.plannedPublishDate
```

- [ ] **Step 3: Update Prisma vector and lexical filters**

In `prisma-review-store.ts`, add SQL/vector filters:

```sql
ec."chunk_status" = 'active'
AND (ec."effective_from" IS NULL OR ec."effective_from" <= $plannedDate::date)
AND (ec."effective_to" IS NULL OR ec."effective_to" >= $plannedDate::date)
AND kd."lifecycle_status" = 'active'
```

For lexical Prisma `findMany`, add equivalent Prisma where clauses when `input.effectiveOn` is present:

```ts
chunkStatus: "active",
OR: [
  { effectiveFrom: null },
  { effectiveFrom: { lte: plannedDate(input.effectiveOn) } }
],
AND: [
  {
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: plannedDate(input.effectiveOn) } }]
  }
]
```

Keep documents with null lifecycle from older rows out of the Prisma path by defaulting the schema field to `active`.

- [ ] **Step 4: Run analysis and store tests**

Run: `npm run test -- src/server/analysis/review-analysis-pipeline.test.ts src/server/reviews/mock-review-store.regulatory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/analysis/review-analysis-pipeline.ts src/server/analysis/review-analysis-pipeline.test.ts src/server/reviews/prisma-review-store.ts src/server/reviews/mock-review-store.ts
git commit -m "feat: retrieve effective regulatory knowledge"
```

---

### Task 10: Regulatory Dashboard And Change Detail UI

**Files:**
- Create: `src/components/regulatory/RegulatoryWatchDashboard.tsx`
- Create: `src/components/regulatory/RegulatoryWatchDashboard.test.tsx`
- Create: `src/components/regulatory/RegulatoryChangeSetDetail.tsx`
- Create: `src/components/regulatory/RegulatoryChangeSetDetail.test.tsx`
- Create: `src/app/regulatory-sources/page.tsx`
- Modify: `src/components/AppShell.tsx`

- [ ] **Step 1: Write dashboard component test**

Create `src/components/regulatory/RegulatoryWatchDashboard.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { RegulatoryWatchDashboard } from "./RegulatoryWatchDashboard";

describe("RegulatoryWatchDashboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows source health and recent change sets", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            sources: [
              {
                id: "reg-source-001",
                sourceType: "internal_policy_repo",
                name: "예금 광고 내부 기준",
                pollingSchedule: "0 9 * * *",
                trustLevel: "internal",
                status: "active",
                lastCheckedAt: "2026-05-31T00:00:00.000Z",
                createdAt: "2026-05-30T00:00:00.000Z",
                updatedAt: "2026-05-31T00:00:00.000Z"
              }
            ]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changeSets: [
              {
                id: "reg-change-001",
                sourceId: "reg-source-001",
                changeSummary: "최고금리 표시 기준이 강화되었습니다.",
                mappedProductTypes: ["deposit"],
                mappedReviewCategories: ["rate_display"],
                qualityGateStatus: "passed",
                createdAt: "2026-05-31T00:00:00.000Z"
              }
            ]
          })
        })
    );

    render(<RegulatoryWatchDashboard />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText("예금 광고 내부 기준")).toBeInTheDocument();
    expect(screen.getByText("정상")).toBeInTheDocument();
    expect(screen.getByText("최고금리 표시 기준이 강화되었습니다.")).toBeInTheDocument();
    expect(screen.getByText("deposit")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement dashboard**

Create `src/components/regulatory/RegulatoryWatchDashboard.tsx`. Use existing app styling classes from nearby components, avoid nested cards, and render:

- top summary counters for tracked sources, failed sources, passed changes, and flagged/failed changes.
- source table with name, type, status label, last checked time.
- recent change-set table with summary, products, categories, gate status.

Use `regulatorySourceStatusLabel` from `src/domain/regulatory.ts`.

- [ ] **Step 3: Write and implement change detail component test**

Create `src/components/regulatory/RegulatoryChangeSetDetail.test.tsx` with a fixture change set containing previous/new text and gate results. Assert the component shows:

```ts
expect(screen.getByText("이전 문구")).toBeInTheDocument();
expect(screen.getByText("변경 문구")).toBeInTheDocument();
expect(screen.getByText("Citation Coverage")).toBeInTheDocument();
expect(screen.getByText("passed")).toBeInTheDocument();
```

Implement `RegulatoryChangeSetDetail.tsx` as a pure component that receives `{ changeSet, qualityGateResults }` props. Keep network fetching in a page-level loader or a dedicated container component, not inside this component.

- [ ] **Step 4: Add route page and navigation**

Create `src/app/regulatory-sources/page.tsx`:

```tsx
import { RegulatoryWatchDashboard } from "@/components/regulatory/RegulatoryWatchDashboard";

export default function RegulatorySourcesPage() {
  return <RegulatoryWatchDashboard />;
}
```

In `src/components/AppShell.tsx`, add a sidebar item for `/regulatory-sources` labeled `규제 변경`.

- [ ] **Step 5: Run UI tests**

Run: `npm run test -- src/components/regulatory/RegulatoryWatchDashboard.test.tsx src/components/regulatory/RegulatoryChangeSetDetail.test.tsx src/components/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/regulatory src/app/regulatory-sources/page.tsx src/components/AppShell.tsx src/components/AppShell.test.tsx
git commit -m "feat: add regulatory knowledge dashboard"
```

---

### Task 11: End-To-End Demo Fixture And Acceptance Tests

**Files:**
- Create: `src/server/regulatory/regulatory-knowledge-demo.test.ts`
- Modify: `docs/test-packages/rag-knowledge/internal_policy_deposit_ad_review_2026.md`
- Modify: `README.md`

- [ ] **Step 1: Write demo acceptance test**

Create `src/server/regulatory/regulatory-knowledge-demo.test.ts`:

```ts
import { createMockReviewStore } from "@/server/reviews/mock-review-store";
import { createRegulatoryKnowledgeService } from "./regulatory-knowledge-service";

const context = {
  tenantId: "tenant-demo",
  userId: "user-reviewer-demo",
  role: "reviewer" as const
};

describe("regulatory knowledge demo flow", () => {
  it("makes changed deposit-rate guidance retrievable after automatic activation", async () => {
    const store = createMockReviewStore([]);
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date("2026-05-31T00:00:00.000Z")
    });
    const scope = {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorRole: context.role
    };
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-demo-rate",
      sourceType: "internal_policy_repo",
      name: "예금 광고 심의 지침",
      repositoryPath: "docs/test-packages/rag-knowledge/internal_policy_deposit_ad_review_2026.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });

    await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "예금 광고 심의 지침",
      version: "2026.07",
      sourceText: "제1조 최고금리 표시\n최고금리 표현 시 기본금리, 우대조건, 적용 한도, 적용 기간을 인접 영역에 함께 표시해야 한다.",
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner", "short_copy"],
      mappedReviewCategories: ["rate_display", "required_disclosure"]
    });

    const evidence = await store.searchKnowledgeEvidence(scope, {
      query: "누구나 최고금리 혜택 기본금리 우대조건 적용 한도",
      productType: "deposit",
      effectiveOn: "2026-07-02",
      minScore: 0.6
    });

    expect(evidence[0]).toMatchObject({
      title: "예금 광고 심의 지침",
      quoteSummary: expect.stringContaining("최고금리")
    });
  });
});
```

- [ ] **Step 2: Add demo knowledge text**

Append this section to `docs/test-packages/rag-knowledge/internal_policy_deposit_ad_review_2026.md`:

```md
## 2026.07 개정 예시: 최고금리 인접 고지 강화

최고금리 표현 시 기본금리, 우대조건, 적용 한도, 적용 기간을 인접 영역에 함께 표시해야 한다.

적용 대상: 예금, 적금, 모바일 배너, 짧은 광고 카피
심의 항목: 금리 표시, 필수 고지, 조건 누락
```

- [ ] **Step 3: Document local demo API flow**

In `README.md`, add a short section named `Regulatory Knowledge Agent Demo` with these commands and payloads:

```bash
npm run dev
```

Then describe:

1. Open `/regulatory-sources`.
2. Create a source with `sourceType=internal_policy_repo`.
3. POST `/api/v1/regulatory-sources/:sourceId/check` with the deposit-rate text from the demo fixture.
4. Open `/knowledge-documents` and confirm the auto-ingested approved document exists.
5. Analyze a deposit advertisement planned after `2026-07-01` and confirm the new evidence appears.

- [ ] **Step 4: Run demo and regression tests**

Run: `npm run test -- src/server/regulatory/regulatory-knowledge-demo.test.ts src/server/regulatory/regulatory-knowledge-service.test.ts src/server/reviews/mock-review-store.regulatory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/regulatory/regulatory-knowledge-demo.test.ts docs/test-packages/rag-knowledge/internal_policy_deposit_ad_review_2026.md README.md
git commit -m "test: add regulatory knowledge demo flow"
```

---

### Task 12: Final Verification

**Files:**
- No source edits unless verification exposes a defect.

- [ ] **Step 1: Run full tests**

Run: `npm run test`

Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Review git diff**

Run: `git status --short`

Expected: only intentional files are modified or untracked.

Run: `git log --oneline -12`

Expected: task commits are present in order.

- [ ] **Step 5: Manual browser verification**

Run: `npm run dev`

Open `/regulatory-sources`. Verify:

- Source dashboard loads without console errors.
- Source health table displays registered regulatory sources.
- Recent change-set table displays the automated deposit-rate change.
- `/knowledge-documents` shows the auto-ingested document as approved.

- [ ] **Step 6: Final commit if verification fixes were needed**

If final verification required fixes:

```bash
git add src/server/regulatory src/server/reviews src/components/regulatory src/app README.md
git commit -m "fix: stabilize regulatory knowledge agent"
```

If no fixes were needed, do not create an empty commit.

---

## Spec Coverage Review

- Source tracking is covered by Tasks 2, 5, 6, 7, 8, and 10.
- Snapshot creation and content hashing are covered by Tasks 2, 5, 6, and 7.
- Section normalization and change detection are covered by Task 3.
- AI-compatible interpretation and impact mapping are covered deterministically in Task 7 and exposed in Tasks 8 and 10.
- Knowledge document and evidence chunk versioning are covered by Tasks 2, 5, 6, and 7.
- Quality gates are covered by Task 4 and integrated in Task 7.
- Audit events are covered by Task 7 and route-level behavior in Task 8.
- Effective-date retrieval is covered by Task 9.
- Dashboard, change detail, and demo flow are covered by Tasks 10 and 11.
- Full verification is covered by Task 12.
