# Analysis Progress Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show reviewers a live (and post-hoc) plain-Korean timeline of what each analysis agent is doing, opened from a popup next to the "분석중" state in both the queue and case detail views.

**Architecture:** The analysis worker runs in a separate process from the Next.js app, so the only shared surface is the DB. Pipeline/subagent stage events (already emitted to CloudWatch) are additionally persisted to a new `analysis_events` table via an injected event sink. A new endpoint returns events after a `seq` cursor; a shared React `AnalysisProgressPopup` polls it every 1.5s and renders each event through a pure humanization mapper.

**Tech Stack:** Next.js (App Router) API routes, Prisma 7 (Postgres/Supabase, hand-written migration applied by `prisma migrate deploy` on deploy), React client components, Vitest.

---

## File Structure

**Create:**
- `prisma/migrations/20260704000000_add_analysis_events/migration.sql` — new table
- `src/server/analysis/analysis-event-sink.ts` — DB-persisting sink factory (seq counter)
- `src/server/analysis/analysis-event-sink.test.ts`
- `src/app/api/v1/review-cases/[caseId]/analysis/events/route.ts` — GET endpoint
- `src/app/api/v1/review-cases/[caseId]/analysis/events/route.test.ts`
- `src/components/analysis/analysis-progress-copy.ts` — pure (event → Korean) mapper
- `src/components/analysis/analysis-progress-copy.test.ts`
- `src/components/analysis/AnalysisProgressPopup.tsx` — shared popup component

**Modify:**
- `prisma/schema.prisma` — add `AnalysisEvent` model + back-relations
- `src/server/reviews/review-store.ts` — add types + 2 interface methods
- `src/server/reviews/prisma-review-store.ts` — implement 2 methods + mapper
- `src/server/reviews/mock-review-store.ts` — implement 2 methods (in-memory)
- `src/server/analysis/analysis-log.ts` — export `AnalysisEventSink` type
- `src/server/analysis/review-analysis-pipeline.ts` — thread `onEvent` through `run()`
- `src/server/analysis/review-subagents.ts` — thread `onEvent` through `run()`/`runAgent`
- `src/server/analysis/analysis-worker.ts` — build sink, pass to `pipeline.run`
- `src/server/reviews/review-service.ts` — inline path sink + `listAnalysisEvents` service method
- `src/components/queue/QueueTable.tsx` — "진행상황" button + `onOpenProgress` prop
- `src/components/ReviewQueue.tsx` — popup open state + render popup
- `src/components/ReviewDetailWorkspace.tsx` — launcher button + render popup

---

## Task 1: Add `analysis_events` schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260704000000_add_analysis_events/migration.sql`

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Add this model (place it right after the `AgentRun` model, near line 561):

```prisma
model AnalysisEvent {
  id           String      @id
  tenantId     String      @map("tenant_id")
  reviewCaseId String      @map("review_case_id")
  jobId        String      @map("job_id")
  seq          Int
  stage        String
  event        String
  payload      Json
  createdAt    DateTime    @default(now()) @map("created_at")
  reviewCase   ReviewCase  @relation(fields: [reviewCaseId], references: [id], onDelete: Cascade)
  analysisJob  AnalysisJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([reviewCaseId, jobId, seq], map: "analysis_events_review_case_job_seq_idx")
  @@map("analysis_events")
}
```

- [ ] **Step 2: Add back-relations**

In model `ReviewCase` (near the other `AgentRun[]`/`AnalysisJob[]` relation fields) add:
```prisma
  analysisEvents  AnalysisEvent[]
```
In model `AnalysisJob` (which already has `agentRuns AgentRun[]` at ~line 454) add:
```prisma
  analysisEvents  AnalysisEvent[]
```

- [ ] **Step 3: Hand-write the migration SQL** (do NOT run `prisma migrate dev` — the local `.env` points at the production DB)

Create `prisma/migrations/20260704000000_add_analysis_events/migration.sql`:
```sql
-- CreateTable
CREATE TABLE "analysis_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_events_review_case_job_seq_idx" ON "analysis_events"("review_case_id", "job_id", "seq");

-- AddForeignKey
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Regenerate the Prisma client** (safe — no DB connection)

Run: `npm run db:generate`
Expected: `✔ Generated Prisma Client ... to ./src/generated/prisma`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260704000000_add_analysis_events src/generated/prisma
git commit -m "feat: add analysis_events table for progress timeline"
```

---

## Task 2: Store types + methods (interface, prisma, mock)

**Files:**
- Modify: `src/server/reviews/review-store.ts`
- Modify: `src/server/reviews/prisma-review-store.ts`
- Modify: `src/server/reviews/mock-review-store.ts`
- Test: `src/server/reviews/mock-review-store.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `src/server/reviews/mock-review-store.test.ts`)

```ts
describe("analysis events", () => {
  it("records events and lists them for the latest job filtered by seq", async () => {
    const store = createMockReviewStore();
    const scope = {
      tenantId: "tenant-demo",
      actorUserId: "user-reviewer",
      actorRole: "reviewer" as const
    };
    const created = await store.createReviewCaseFromSamplePackage(scope, {
      samplePackageId: "sample-deposit-001"
    });
    const caseId = created!.reviewCaseId;
    const queued = await store.enqueueAnalysis(scope, caseId);
    const jobId = queued!.jobId;

    await store.recordAnalysisEvent(scope, {
      reviewCaseId: caseId,
      jobId,
      seq: 0,
      stage: "pipeline",
      event: "start",
      payload: { stage: "pipeline", event: "start", case: caseId }
    });
    await store.recordAnalysisEvent(scope, {
      reviewCaseId: caseId,
      jobId,
      seq: 1,
      stage: "ocr",
      event: "done",
      payload: { stage: "ocr", event: "done", docs: 2 }
    });

    const all = await store.listAnalysisEvents(scope, caseId, {});
    expect(all.jobId).toBe(jobId);
    expect(all.events.map((e) => e.seq)).toEqual([0, 1]);

    const afterFirst = await store.listAnalysisEvents(scope, caseId, { since: 0 });
    expect(afterFirst.events.map((e) => e.seq)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/reviews/mock-review-store.test.ts -t "analysis events"`
Expected: FAIL — `store.recordAnalysisEvent is not a function`.

- [ ] **Step 3: Add types + interface methods** to `src/server/reviews/review-store.ts`

Add near the other analysis types (after `AnalysisResult`):
```ts
export type AnalysisEventInput = {
  reviewCaseId: string;
  jobId: string;
  seq: number;
  stage: string;
  event: string;
  payload: Record<string, unknown>;
};

export type AnalysisEventRecord = {
  id: string;
  seq: number;
  stage: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type AnalysisEventsResult = {
  jobId: string | null;
  status: "queued" | "running" | "completed" | "failed" | null;
  events: AnalysisEventRecord[];
};
```
Add to the `ReviewStore` interface (near `getLatestAnalysisJob`):
```ts
  recordAnalysisEvent(scope: ReviewStoreScope, input: AnalysisEventInput): Promise<void>;
  listAnalysisEvents(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    options: { since?: number }
  ): Promise<AnalysisEventsResult>;
```

- [ ] **Step 4: Implement in `src/server/reviews/prisma-review-store.ts`**

Add a mapper near `toAnalysisJob` (top of file):
```ts
function toAnalysisEventRecord(row: {
  id: string;
  seq: number;
  stage: string;
  event: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
}): AnalysisEventRecord {
  return {
    id: row.id,
    seq: row.seq,
    stage: row.stage,
    event: row.event,
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    createdAt: row.createdAt.toISOString()
  };
}
```
Add the two methods inside the object returned by `createPrismaReviewStore` (near `getLatestAnalysisJob`):
```ts
    async recordAnalysisEvent(scope, input) {
      await prisma.analysisEvent.create({
        data: {
          id: `evt-${randomUUID()}`,
          tenantId: scope.tenantId,
          reviewCaseId: input.reviewCaseId,
          jobId: input.jobId,
          seq: input.seq,
          stage: input.stage,
          event: input.event,
          payload: input.payload as Prisma.InputJsonValue
        }
      });
    },
    async listAnalysisEvents(scope, reviewCaseId, options) {
      const job = await prisma.analysisJob.findFirst({
        where: { tenantId: scope.tenantId, reviewCaseId },
        orderBy: { queuedAt: "desc" }
      });
      if (!job) {
        return { jobId: null, status: null, events: [] };
      }
      const rows = await prisma.analysisEvent.findMany({
        where: {
          tenantId: scope.tenantId,
          reviewCaseId,
          jobId: job.id,
          ...(typeof options.since === "number" ? { seq: { gt: options.since } } : {})
        },
        orderBy: { seq: "asc" }
      });
      return {
        jobId: job.id,
        status: job.status as AnalysisEventsResult["status"],
        events: rows.map(toAnalysisEventRecord)
      };
    },
```
Add the imports `AnalysisEventRecord`, `AnalysisEventsResult` to the existing type import from `./review-store` at the top of the file.

- [ ] **Step 5: Implement in `src/server/reviews/mock-review-store.ts`**

Add a field near `analysisJobs = new Map(...)` (line ~389):
```ts
  const analysisEvents: Array<{
    id: string;
    tenantId: string;
    reviewCaseId: string;
    jobId: string;
    seq: number;
    stage: string;
    event: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }> = [];
```
Add the two methods to the returned object (near `getLatestAnalysisJob` at line ~1362):
```ts
    async recordAnalysisEvent(scope, input) {
      analysisEvents.push({
        id: `evt-${analysisEvents.length + 1}`,
        tenantId: scope.tenantId,
        reviewCaseId: input.reviewCaseId,
        jobId: input.jobId,
        seq: input.seq,
        stage: input.stage,
        event: input.event,
        payload: input.payload,
        createdAt: new Date().toISOString()
      });
    },
    async listAnalysisEvents(scope, reviewCaseId, options) {
      const jobs = [...analysisJobs.values()]
        .filter((job) => job.tenantId === scope.tenantId && job.reviewCaseId === reviewCaseId)
        .sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : -1));
      const job = jobs[0];
      if (!job) {
        return { jobId: null, status: null, events: [] };
      }
      const events = analysisEvents
        .filter(
          (e) =>
            e.tenantId === scope.tenantId &&
            e.reviewCaseId === reviewCaseId &&
            e.jobId === job.id &&
            (typeof options.since === "number" ? e.seq > options.since : true)
        )
        .sort((a, b) => a.seq - b.seq)
        .map((e) => ({
          id: e.id,
          seq: e.seq,
          stage: e.stage,
          event: e.event,
          payload: e.payload,
          createdAt: e.createdAt
        }));
      return { jobId: job.id, status: job.status, events };
    },
```
(If the in-memory job object stores `queuedAt`/`status` under different names, match the existing shape used by the mock's `getLatestAnalysisJob`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/server/reviews/mock-review-store.test.ts -t "analysis events"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/reviews/review-store.ts src/server/reviews/prisma-review-store.ts src/server/reviews/mock-review-store.ts src/server/reviews/mock-review-store.test.ts
git commit -m "feat: add recordAnalysisEvent/listAnalysisEvents store methods"
```

---

## Task 3: Event sink factory

**Files:**
- Modify: `src/server/analysis/analysis-log.ts`
- Create: `src/server/analysis/analysis-event-sink.ts`
- Test: `src/server/analysis/analysis-event-sink.test.ts`

- [ ] **Step 1: Export the sink type** in `src/server/analysis/analysis-log.ts`

Append:
```ts
export type AnalysisEventSink = (payload: Record<string, unknown>) => void;
```

- [ ] **Step 2: Write the failing test** `src/server/analysis/analysis-event-sink.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { createDbAnalysisEventSink } from "./analysis-event-sink";

describe("createDbAnalysisEventSink", () => {
  it("assigns a monotonic seq per event and forwards to the store", async () => {
    const recordAnalysisEvent = vi.fn(async () => {});
    const sink = createDbAnalysisEventSink({
      store: { recordAnalysisEvent },
      scope: { tenantId: "t", actorUserId: "u", actorRole: "reviewer" },
      reviewCaseId: "rc-1",
      jobId: "job-1"
    });
    sink({ stage: "pipeline", event: "start" });
    sink({ stage: "ocr", event: "done", docs: 2 });
    await Promise.resolve();
    expect(recordAnalysisEvent).toHaveBeenCalledTimes(2);
    expect(recordAnalysisEvent.mock.calls[0][1]).toMatchObject({ seq: 0, stage: "pipeline" });
    expect(recordAnalysisEvent.mock.calls[1][1]).toMatchObject({ seq: 1, stage: "ocr" });
  });

  it("never throws when the store rejects", async () => {
    const recordAnalysisEvent = vi.fn(async () => {
      throw new Error("db down");
    });
    const sink = createDbAnalysisEventSink({
      store: { recordAnalysisEvent },
      scope: { tenantId: "t", actorUserId: "u", actorRole: "reviewer" },
      reviewCaseId: "rc-1",
      jobId: "job-1"
    });
    expect(() => sink({ stage: "pipeline", event: "start" })).not.toThrow();
    await Promise.resolve();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/server/analysis/analysis-event-sink.test.ts`
Expected: FAIL — cannot find module `./analysis-event-sink`.

- [ ] **Step 4: Implement `src/server/analysis/analysis-event-sink.ts`**

```ts
import type { ReviewStore, ReviewStoreScope } from "@/server/reviews/review-store";
import type { AnalysisEventSink } from "./analysis-log";

/**
 * Builds an event sink that persists each pipeline/subagent event to the
 * analysis_events table. A synchronous per-run counter assigns `seq` at emit
 * time so parallel sub-agent events keep a stable order regardless of when the
 * async DB writes settle. Persistence failures are swallowed — observability
 * must never break an analysis run (the console log is emitted separately).
 */
export function createDbAnalysisEventSink(params: {
  store: Pick<ReviewStore, "recordAnalysisEvent">;
  scope: ReviewStoreScope;
  reviewCaseId: string;
  jobId: string;
}): AnalysisEventSink {
  let seq = 0;
  return (payload) => {
    const current = seq;
    seq += 1;
    void params.store
      .recordAnalysisEvent(params.scope, {
        reviewCaseId: params.reviewCaseId,
        jobId: params.jobId,
        seq: current,
        stage: String(payload.stage ?? "unknown"),
        event: String(payload.event ?? ""),
        payload
      })
      .catch(() => {
        // swallow — persistence must not affect the run
      });
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/server/analysis/analysis-event-sink.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/analysis/analysis-log.ts src/server/analysis/analysis-event-sink.ts src/server/analysis/analysis-event-sink.test.ts
git commit -m "feat: add DB analysis event sink with monotonic seq"
```

---

## Task 4: Thread `onEvent` through pipeline + subagents

**Files:**
- Modify: `src/server/analysis/review-analysis-pipeline.ts`
- Modify: `src/server/analysis/review-subagents.ts`

- [ ] **Step 1: Extend the subagent orchestrator to accept `onEvent`** in `src/server/analysis/review-subagents.ts`

Change the orchestrator `run` input type (line ~63) to add an optional sink:
```ts
export type ReviewSubAgentOrchestrator = {
  run(input: {
    review: ReviewCase;
    extractedDocuments: ExtractedDocument[];
    evidenceCandidates: RagEvidenceCandidate[];
    priorFindings?: AgentFinding[];
    onEvent?: (payload: Record<string, unknown>) => void;
  }): Promise<AgentFinding[]>;
};
```
Add an `onEvent` param to `runAgent` (line ~529). In its destructured params add:
```ts
  onEvent
}: {
  provider: ModelProvider;
  agent: ReviewSubAgentDefinition;
  input: { review: ReviewCase; extractedDocuments: ExtractedDocument[]; evidenceCandidates: RagEvidenceCandidate[] };
  priorFindings?: AgentFinding[];
  routeContext?: ModelRouteContext;
  onEvent?: (payload: Record<string, unknown>) => void;
}) {
```
Inside `runAgent`, replace the existing `logAnalysisEvent({...})` start call (line ~547) and done call (line ~578) so each emits to BOTH console and the sink. Add a local helper at the top of `runAgent`:
```ts
  const emit = (payload: Record<string, unknown>) => {
    logAnalysisEvent(payload);
    onEvent?.(payload);
  };
```
Then change the two `logAnalysisEvent(` calls to `emit(`.

In `run()` (the factory return, line ~592), destructure `onEvent` from input and pass it to every `runAgent(...)` call (there are 5: domain agents map ~line 600, evidence verification ~615, case search ~632, main ~647). Example for the domain map:
```ts
    async run(input) {
      const onEvent = input.onEvent;
      const priorFindings = input.priorFindings ?? [];
      const domainFindings = await Promise.all(
        domainSubAgents.map((agent) => runAgent({ provider, agent, input, onEvent }))
      );
```
And add `onEvent` to each of the other 4 `runAgent({ ... })` calls.

- [ ] **Step 2: Extend the pipeline `run()` input + emit helper** in `src/server/analysis/review-analysis-pipeline.ts`

Change the exported `ReviewAnalysisPipeline` type (line ~128):
```ts
export type ReviewAnalysisPipeline = {
  run(input: {
    review: ReviewCase;
    scope?: ReviewStoreScope;
    jobId?: string;
    onEvent?: (payload: Record<string, unknown>) => void;
  }): Promise<AnalysisArtifacts>;
  extractOnly(input: { review: ReviewCase; scope?: ReviewStoreScope }): Promise<ExtractedDocument[]>;
};
```
At the top of `run({ review, scope, onEvent })` (line ~1762) add a local emit helper immediately after the signature:
```ts
    async run({ review, scope, onEvent }) {
      const emit = (payload: Record<string, unknown>) => {
        logAnalysisEvent(payload);
        onEvent?.(payload);
      };
```
Replace all 8 `logAnalysisEvent(` calls inside `run()` with `emit(`.
Pass the sink into the orchestrator call (line ~1882):
```ts
      const orchestratedFindings = await subAgentOrchestrator.run({
        review,
        extractedDocuments: analysisDocuments,
        evidenceCandidates,
        priorFindings: multilingualResult.agentFindings,
        onEvent
      });
```

- [ ] **Step 3: Run the analysis test suite to verify no regression**

Run: `npx vitest run src/server/analysis`
Expected: PASS (all existing analysis tests; `onEvent` is optional so existing callers are unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/server/analysis/review-analysis-pipeline.ts src/server/analysis/review-subagents.ts
git commit -m "feat: thread onEvent sink through pipeline and sub-agents"
```

---

## Task 5: Wire the DB sink into worker + inline paths

**Files:**
- Modify: `src/server/analysis/analysis-worker.ts`
- Modify: `src/server/reviews/review-service.ts`
- Test: `src/server/analysis/analysis-worker.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `src/server/analysis/analysis-worker.test.ts`)

```ts
it("records analysis events through the store during a run", async () => {
  const { store, scope } = await seedQueuedJob(); // reuse the file's existing setup helper/pattern
  const recorded: Array<{ stage: string; seq: number }> = [];
  const originalRecord = store.recordAnalysisEvent.bind(store);
  store.recordAnalysisEvent = async (s, input) => {
    recorded.push({ stage: input.stage, seq: input.seq });
    return originalRecord(s, input);
  };
  const worker = createAnalysisWorker({
    store,
    pipeline: {
      async run({ onEvent }) {
        onEvent?.({ stage: "pipeline", event: "start" });
        onEvent?.({ stage: "combine", event: "done" });
        return { generatedAt: new Date().toISOString(), extractedDocuments: [], evidenceCandidates: [], findings: [] };
      },
      async extractOnly() {
        return [];
      }
    }
  });
  await worker.runOnce({ tenantId: scope.tenantId, workerId: "w1" });
  expect(recorded.map((r) => r.seq)).toEqual([0, 1]);
  expect(recorded.map((r) => r.stage)).toEqual(["pipeline", "combine"]);
});
```
(Match `seedQueuedJob`/setup to the helpers already present at the top of `analysis-worker.test.ts`; if none exists, seed inline with `createMockReviewStore()` + `enqueueAnalysis` as the existing tests do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/analysis/analysis-worker.test.ts -t "records analysis events"`
Expected: FAIL — `onEvent` is undefined (worker does not build a sink yet).

- [ ] **Step 3: Wire the sink in `src/server/analysis/analysis-worker.ts`**

Import at top:
```ts
import { createDbAnalysisEventSink } from "@/server/analysis/analysis-event-sink";
```
At the `pipeline.run` call (line ~85), build and pass the sink:
```ts
      const onEvent = createDbAnalysisEventSink({
        store,
        scope,
        reviewCaseId: claimed.reviewCaseId,
        jobId: claimed.id
      });
      const artifacts = await pipeline.run({
        review: claimed.reviewCase,
        scope,
        onEvent
      });
```

- [ ] **Step 4: Wire the sink in the inline path** `src/server/reviews/review-service.ts`

Import at top:
```ts
import { createDbAnalysisEventSink } from "@/server/analysis/analysis-event-sink";
```
At the inline `analysisPipeline.run` call (line ~396), pass a sink built from the enqueued job id:
```ts
      const onEvent = createDbAnalysisEventSink({
        store,
        scope,
        reviewCaseId,
        jobId: queued.jobId
      });
      const artifacts = await analysisPipeline.run({ review: before, scope, onEvent });
```
(Use the exact `reviewCaseId` variable already in scope for `startAnalysis`; it is the case id passed to the method.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/server/analysis/analysis-worker.test.ts -t "records analysis events"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/analysis/analysis-worker.ts src/server/reviews/review-service.ts src/server/analysis/analysis-worker.test.ts
git commit -m "feat: persist analysis events from worker and inline paths"
```

---

## Task 6: Service method + events API route

**Files:**
- Modify: `src/server/reviews/review-service.ts`
- Create: `src/app/api/v1/review-cases/[caseId]/analysis/events/route.ts`
- Test: `src/app/api/v1/review-cases/[caseId]/analysis/events/route.test.ts`

- [ ] **Step 1: Add the service method** to `src/server/reviews/review-service.ts`

Near `getAnalysisStatus` (line ~438) add:
```ts
    async listAnalysisEvents(context: RequestContext, reviewCaseId: string, options: { since?: number }) {
      const scope = scopeFromContext(context);
      const reviewCase = await store.getReviewCase(scope, reviewCaseId);
      if (!reviewCase) {
        return undefined;
      }
      return store.listAnalysisEvents(scope, reviewCaseId, options);
    },
```
(Match the exact `RequestContext` type import already used by `getAnalysisStatus`.)

- [ ] **Step 2: Write the failing route test** `src/app/api/v1/review-cases/[caseId]/analysis/events/route.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: {
    listAnalysisEvents: vi.fn()
  }
}));

vi.mock("@/server/reviews/review-service", () => ({
  createReviewService: () => mocks.service
}));
vi.mock("@/server/reviews/route-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/reviews/route-utils")>();
  return { ...actual, requestContext: vi.fn(async () => ({ tenantId: "t", userId: "u", role: "reviewer" })) };
});

import { GET } from "./route";

describe("GET analysis/events", () => {
  it("returns events for the case", async () => {
    mocks.service.listAnalysisEvents.mockResolvedValue({
      jobId: "job-1",
      status: "running",
      events: [{ id: "evt-1", seq: 0, stage: "pipeline", event: "start", payload: {}, createdAt: "2026-07-04T00:00:00.000Z" }]
    });
    const request = new Request("http://localhost/api/v1/review-cases/rc-1/analysis/events?since=0");
    const response = await GET(request, { params: Promise.resolve({ caseId: "rc-1" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobId).toBe("job-1");
    expect(body.events).toHaveLength(1);
    expect(mocks.service.listAnalysisEvents.mock.calls[0][2]).toEqual({ since: 0 });
  });

  it("404s when the case is missing", async () => {
    mocks.service.listAnalysisEvents.mockResolvedValue(undefined);
    const request = new Request("http://localhost/api/v1/review-cases/rc-x/analysis/events");
    const response = await GET(request, { params: Promise.resolve({ caseId: "rc-x" }) });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run "src/app/api/v1/review-cases/[caseId]/analysis/events/route.test.ts"`
Expected: FAIL — cannot find `./route`.

- [ ] **Step 4: Implement `src/app/api/v1/review-cases/[caseId]/analysis/events/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, requestContext, type RouteContext } from "@/server/reviews/route-utils";

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const sinceParam = new URL(request.url).searchParams.get("since");
  const sinceValue = sinceParam !== null ? Number(sinceParam) : Number.NaN;
  const since = Number.isFinite(sinceValue) ? sinceValue : undefined;

  const result = await createReviewService().listAnalysisEvents(
    await requestContext(request),
    caseId,
    { since }
  );
  if (!result) {
    return jsonError("Review case not found", 404, "NOT_FOUND");
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run "src/app/api/v1/review-cases/[caseId]/analysis/events/route.test.ts"`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/server/reviews/review-service.ts "src/app/api/v1/review-cases/[caseId]/analysis/events"
git commit -m "feat: add analysis events service method and API route"
```

---

## Task 7: Humanization mapper (pure function)

**Files:**
- Create: `src/components/analysis/analysis-progress-copy.ts`
- Test: `src/components/analysis/analysis-progress-copy.test.ts`

- [ ] **Step 1: Write the failing test** `src/components/analysis/analysis-progress-copy.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { describeAnalysisEvent } from "./analysis-progress-copy";

describe("describeAnalysisEvent", () => {
  it("humanizes ocr done", () => {
    const line = describeAnalysisEvent({
      id: "e1", seq: 1, stage: "ocr", event: "done",
      payload: { docs: 3 }, createdAt: "2026-07-04T00:00:00.000Z"
    });
    expect(line.text).toContain("3");
    expect(line.state).toBe("done");
  });

  it("labels a subagent start with a friendly name and running state", () => {
    const line = describeAnalysisEvent({
      id: "e2", seq: 2, stage: "subagent", event: "start",
      payload: { agent: "regulation" }, createdAt: "2026-07-04T00:00:00.000Z"
    });
    expect(line.text).toContain("규정");
    expect(line.state).toBe("running");
  });

  it("exposes evidence chips on rerank done", () => {
    const line = describeAnalysisEvent({
      id: "e3", seq: 3, stage: "rerank", event: "done",
      payload: { topDocs: [{ title: "전자금융감독규정 §5", score: 0.71 }] },
      createdAt: "2026-07-04T00:00:00.000Z"
    });
    expect(line.evidence).toEqual(["전자금융감독규정 §5"]);
  });

  it("falls back safely for unknown stages", () => {
    const line = describeAnalysisEvent({
      id: "e4", seq: 4, stage: "mystery", event: "poke",
      payload: {}, createdAt: "2026-07-04T00:00:00.000Z"
    });
    expect(line.text.length).toBeGreaterThan(0);
    expect(line.state).toBe("info");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/analysis/analysis-progress-copy.test.ts`
Expected: FAIL — cannot find `./analysis-progress-copy`.

- [ ] **Step 3: Implement `src/components/analysis/analysis-progress-copy.ts`**

```ts
import type { AnalysisEventRecord } from "@/server/reviews/review-store";

export type ProgressLine = {
  id: string;
  seq: number;
  state: "running" | "done" | "info" | "error";
  text: string;
  evidence?: string[];
};

const AGENT_LABELS: Record<string, string> = {
  creative_review: "광고 표현 심의",
  product_terms: "상품 조건 확인",
  regulation: "규정 위반 검토",
  internal_policy: "내부 지침 검토",
  social_context_risk: "사회적 맥락 리스크 검토",
  evidence_verification: "근거 검증",
  case_search: "유사 사례 탐색",
  main: "최종 종합 판단"
};

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function titlesFrom(topDocs: unknown): string[] {
  if (!Array.isArray(topDocs)) return [];
  return topDocs
    .map((doc) => (doc && typeof doc === "object" ? (doc as { title?: unknown }).title : undefined))
    .filter((title): title is string => typeof title === "string");
}

/**
 * Pure mapping from a persisted analysis event to a reviewer-facing line.
 * Any unknown stage/agent falls back to a safe generic line (never throws).
 */
export function describeAnalysisEvent(event: AnalysisEventRecord): ProgressLine {
  const base = { id: event.id, seq: event.seq };
  const p = event.payload as Record<string, unknown>;
  const key = `${event.stage}:${event.event}`;

  switch (key) {
    case "pipeline:start":
      return { ...base, state: "info", text: "심의를 시작합니다" };
    case "ocr:done":
      return { ...base, state: "done", text: `첨부 ${num(p.docs) ?? 0}건에서 내용을 읽었어요` };
    case "query_expansion:done":
      return { ...base, state: "done", text: "핵심 개념을 뽑아 관련 규정을 찾을 준비를 했어요" };
    case "rag_retrieve:done":
      return { ...base, state: "done", text: `관련 규정·사례 후보 ${num(p.candidates) ?? 0}건을 찾았어요` };
    case "rerank:done":
      return {
        ...base,
        state: "done",
        text: "가장 관련 높은 근거를 선별했어요",
        evidence: titlesFrom(p.topDocs)
      };
    case "evidence_select:done":
      return {
        ...base,
        state: "done",
        text: `심사 근거 ${num(p.selected) ?? 0}건을 확정했어요`,
        evidence: Array.isArray(p.titles) ? (p.titles as unknown[]).filter((t): t is string => typeof t === "string") : undefined
      };
    case "orchestrate:start":
      return { ...base, state: "info", text: "전문 에이전트들이 검토를 시작해요" };
    case "combine:done":
      return { ...base, state: "done", text: `분석 완료 — 총 ${num(p.agentFindings) ?? 0}개 항목을 도출했어요` };
    default:
      break;
  }

  if (event.stage === "subagent") {
    const label = AGENT_LABELS[String(p.agent ?? "")] ?? "에이전트 검토";
    if (event.event === "start") {
      return { ...base, state: "running", text: `${label} 중이에요…` };
    }
    const findings = num(p.findings) ?? 0;
    return { ...base, state: "done", text: `${label} 완료 — ${findings}건 확인` };
  }

  return { ...base, state: "info", text: "분석을 진행하고 있어요" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/analysis/analysis-progress-copy.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/components/analysis/analysis-progress-copy.ts src/components/analysis/analysis-progress-copy.test.ts
git commit -m "feat: add reviewer-facing analysis progress copy mapper"
```

---

## Task 8: `AnalysisProgressPopup` component

**Files:**
- Create: `src/components/analysis/AnalysisProgressPopup.tsx`

- [ ] **Step 1: Implement the component** `src/components/analysis/AnalysisProgressPopup.tsx`

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, CircleDot, X, AlertCircle } from "lucide-react";
import { useRole } from "@/components/RoleContext";
import type { AnalysisEventRecord } from "@/server/reviews/review-store";
import { describeAnalysisEvent } from "./analysis-progress-copy";

type EventsResponse = {
  jobId: string | null;
  status: "queued" | "running" | "completed" | "failed" | null;
  events: AnalysisEventRecord[];
};

const POLL_MS = 1500;

export function AnalysisProgressPopup({
  reviewCaseId,
  open,
  onClose
}: {
  reviewCaseId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { apiHeaders } = useRole();
  const [events, setEvents] = useState<AnalysisEventRecord[]>([]);
  const [status, setStatus] = useState<EventsResponse["status"]>(null);
  const jobIdRef = useRef<string | null>(null);
  const cursorRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (!reviewCaseId) return;
    const since = cursorRef.current;
    const url =
      `/api/v1/review-cases/${reviewCaseId}/analysis/events` +
      (since !== null ? `?since=${since}` : "");
    try {
      const res = await fetch(url, { headers: apiHeaders() });
      if (!res.ok) return;
      const body = (await res.json()) as EventsResponse;
      if (body.jobId !== jobIdRef.current) {
        jobIdRef.current = body.jobId;
        cursorRef.current = null;
        setEvents(body.events);
      } else if (body.events.length > 0) {
        setEvents((prev) => [...prev, ...body.events]);
      }
      const last = body.events[body.events.length - 1];
      if (last) cursorRef.current = last.seq;
      setStatus(body.status);
      if (body.status === "queued" || body.status === "running") {
        timerRef.current = setTimeout(() => void poll(), POLL_MS);
      }
    } catch {
      timerRef.current = setTimeout(() => void poll(), POLL_MS);
    }
  }, [reviewCaseId, apiHeaders]);

  useEffect(() => {
    if (!open || !reviewCaseId) return;
    setEvents([]);
    setStatus(null);
    jobIdRef.current = null;
    cursorRef.current = null;
    void poll();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, reviewCaseId, poll]);

  if (!open) return null;

  const lines = events.map(describeAnalysisEvent);

  return (
    <section className="analysis-progress" role="dialog" aria-modal="false" aria-label="AI 분석 진행상황">
      <header className="analysis-progress__header">
        <span className="analysis-progress__title">AI 분석 진행상황</span>
        <button type="button" className="analysis-progress__close" onClick={onClose} aria-label="닫기">
          <X size={16} />
        </button>
      </header>
      <ol className="analysis-progress__list">
        {lines.map((line) => (
          <li key={line.id} className="analysis-progress__item" data-state={line.state}>
            <span className="analysis-progress__icon">
              {line.state === "running" ? (
                <Loader2 className="analysis-progress__spin" size={16} />
              ) : line.state === "done" ? (
                <CheckCircle2 size={16} />
              ) : line.state === "error" ? (
                <AlertCircle size={16} />
              ) : (
                <CircleDot size={16} />
              )}
            </span>
            <span className="analysis-progress__text">
              {line.text}
              {line.evidence && line.evidence.length > 0 ? (
                <span className="analysis-progress__chips">
                  {line.evidence.map((chip, index) => (
                    <span key={index} className="analysis-progress__chip">{chip}</span>
                  ))}
                </span>
              ) : null}
            </span>
          </li>
        ))}
        {lines.length === 0 ? (
          <li className="analysis-progress__item" data-state="info">
            <span className="analysis-progress__text">분석 대기 중이에요…</span>
          </li>
        ) : null}
        {status === "failed" ? (
          <li className="analysis-progress__item" data-state="error">
            <span className="analysis-progress__text">분석이 중단되었어요</span>
          </li>
        ) : null}
      </ol>
    </section>
  );
}
```
(Confirm the RoleContext hook name/exported `apiHeaders`: it is `useRole()` returning `{ apiHeaders }` per RoleContext.tsx line 274-292. If the hook is named differently, match the existing import used elsewhere, e.g. in ReviewQueue.tsx.)

- [ ] **Step 2: Add minimal styles**

Append the following to the global stylesheet that already defines `.chat-widget` (locate it via `grep -rl "chat-widget__panel" src/**/*.css` or the imported CSS in ReviewDetailWorkspace). Add:
```css
.analysis-progress { position: fixed; right: 1.5rem; bottom: 5.5rem; width: 360px; max-height: 60vh; overflow: auto; background: var(--surface, #fff); border: 1px solid var(--border, #e5e7eb); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.16); z-index: 60; }
.analysis-progress__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border, #e5e7eb); font-weight: 600; }
.analysis-progress__close { background: none; border: none; cursor: pointer; color: inherit; }
.analysis-progress__list { list-style: none; margin: 0; padding: 8px 0; }
.analysis-progress__item { display: flex; gap: 8px; padding: 6px 14px; align-items: flex-start; font-size: 0.875rem; }
.analysis-progress__item[data-state="running"] { color: #2563eb; }
.analysis-progress__item[data-state="done"] { color: #111827; }
.analysis-progress__item[data-state="error"] { color: #dc2626; }
.analysis-progress__item[data-state="info"] { color: #6b7280; }
.analysis-progress__spin { animation: spin 1s linear infinite; }
.analysis-progress__chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.analysis-progress__chip { background: #f3f4f6; border-radius: 999px; padding: 2px 8px; font-size: 0.75rem; color: #374151; }
@keyframes spin { to { transform: rotate(360deg); } }
```
(If the project uses CSS modules or a specific global file, add these there; match the existing convention used by `.chat-widget`.)

- [ ] **Step 3: Verify it type-checks and lints**

Run: `npx eslint src/components/analysis/AnalysisProgressPopup.tsx --max-warnings=0`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/analysis/AnalysisProgressPopup.tsx <path-to-css>
git commit -m "feat: add AnalysisProgressPopup component"
```

---

## Task 9: Wire the popup into queue + detail

**Files:**
- Modify: `src/components/queue/QueueTable.tsx`
- Modify: `src/components/ReviewQueue.tsx`
- Modify: `src/components/ReviewDetailWorkspace.tsx`

- [ ] **Step 1: Add an `onOpenProgress` prop + button to `QueueTable.tsx`**

In `QueueTableProps` (line ~86) add:
```ts
  onOpenProgress?: (review: ReviewSummary) => void;
```
In the analyzing block (line ~468-491), next to the `분석중/대기중` label, add (only when `activelyAnalyzing`):
```tsx
{activelyAnalyzing && onOpenProgress ? (
  <button
    type="button"
    className="queue-progress-button"
    onClick={() => onOpenProgress(review)}
  >
    진행상황
  </button>
) : null}
```

- [ ] **Step 2: Render the popup from `ReviewQueue.tsx`**

Add imports:
```tsx
import { AnalysisProgressPopup } from "@/components/analysis/AnalysisProgressPopup";
```
Add state (near `analysisStates`, line ~112):
```tsx
const [progressCaseId, setProgressCaseId] = useState<string | null>(null);
```
Pass the handler to `<QueueTable ...>` (near line ~575-596):
```tsx
onOpenProgress={(review) => setProgressCaseId(review.id)}
```
Render the popup once, after the table:
```tsx
<AnalysisProgressPopup
  reviewCaseId={progressCaseId}
  open={progressCaseId !== null}
  onClose={() => setProgressCaseId(null)}
/>
```

- [ ] **Step 3: Add a launcher + popup to `ReviewDetailWorkspace.tsx`**

Add import (same as above). Add state near `isChatWidgetOpen` (line ~415):
```tsx
const [isProgressOpen, setIsProgressOpen] = useState(false);
```
Add a launcher button near the chat launcher (line ~1572) — reuse the visual pattern:
```tsx
<button
  type="button"
  className="progress-launcher"
  onClick={() => setIsProgressOpen((open) => !open)}
>
  분석 진행상황
</button>
```
Render the popup (near the chat widget block, line ~1541):
```tsx
<AnalysisProgressPopup
  reviewCaseId={review.id}
  open={isProgressOpen}
  onClose={() => setIsProgressOpen(false)}
/>
```
(Use the case id variable already in scope — confirm it is `review.id`; match the field ReviewDetailWorkspace already uses for the chat/status fetch URL.)

- [ ] **Step 4: Type-check + lint the touched components**

Run: `npx eslint src/components/queue/QueueTable.tsx src/components/ReviewQueue.tsx src/components/ReviewDetailWorkspace.tsx --max-warnings=0`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/queue/QueueTable.tsx src/components/ReviewQueue.tsx src/components/ReviewDetailWorkspace.tsx
git commit -m "feat: open analysis progress popup from queue and detail"
```

---

## Task 10: Full verification + deploy

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all pass (previous baseline: 685 passed, 2 skipped, plus the new tests).

- [ ] **Step 2: Lint the whole project**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Production build smoke**

Run: `npm run build`
Expected: build succeeds (App Router compiles the new route + client component).

- [ ] **Step 4: Push to org + deploy**

```bash
git fetch origin && git pull --rebase origin sprint-0
git push origin sprint-0
git push personal HEAD:sprint-0
git tag -a deploy-analysis-progress-<YYYYMMDD-HHMM> -m "Deploy analysis progress popup"
git push personal deploy-analysis-progress-<YYYYMMDD-HHMM>
```
The deploy runs `prisma migrate deploy` (`ops/ec2/deploy.sh` line 67), which applies `20260704000000_add_analysis_events`. Watch the run:
```bash
gh run watch <run-id> --repo h01024380577-blip/FinProof --exit-status
```

- [ ] **Step 5: Post-deploy verification**

- Confirm the migration applied (deploy log shows `Applying migration 20260704000000_add_analysis_events`).
- Trigger an analysis (with user authorization for the prod DB reset) and confirm `GET /api/v1/review-cases/<id>/analysis/events` returns growing events; open the popup in the UI and confirm the Korean timeline streams.

---

## Notes / Risks

- **Do NOT run `prisma migrate dev`** locally — `.env` targets the production DB. The migration SQL is hand-written and applied by `prisma migrate deploy` on deploy.
- `onEvent` is optional everywhere, so all existing pipeline/orchestrator callers and tests are unaffected.
- The DB sink is fire-and-forget and swallows errors; a DB hiccup degrades the popup but never breaks analysis. CloudWatch logging is unchanged (still emitted alongside).
- `seq` is assigned by a synchronous per-run counter, so parallel sub-agent events keep a stable, gap-free order for the `since` cursor.
- **Component test coverage:** the repo currently has no React Testing Library / jsdom setup (all tests are server-side). Rather than introduce that infra, the reviewer-facing logic is fully unit-tested in the pure `describeAnalysisEvent` mapper (Task 7); `AnalysisProgressPopup` itself is verified via lint + `npm run build` + post-deploy manual check (Task 10 Step 5). If component tests are desired later, add `@testing-library/react` + a jsdom vitest environment as a separate task.
