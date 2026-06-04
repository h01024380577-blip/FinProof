# Analysis Queue Operational Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-case AI analysis behave as durable queued jobs with accurate per-row progress, failure display, and retry behavior.

**Architecture:** Keep review case status as workflow state, but drive active queue UI from latest analysis job status. Add a per-review analysis state map in `ReviewQueue`, pass row-specific state into `QueueTable`, and use `/analysis/status` polling for queued, running, completed, and failed jobs.

**Tech Stack:** Next.js App Router route handlers, React client components, TypeScript, Vitest, React Testing Library, Prisma-backed review store.

---

## File Structure

- Modify `src/components/ReviewQueue.tsx`: hold per-review analysis job state, poll `/analysis/status`, and refresh completed review rows.
- Modify `src/components/queue/QueueTable.tsx`: render per-row queued/running/failed state and retry action.
- Modify `src/components/ReviewQueue.test.tsx`: cover multi-row active jobs and failed job UI behavior.
- Modify `src/components/queue/QueueTable.test.tsx`: cover row-level job state rendering.
- Keep `src/server/analysis/rerank-provider.ts`: verify existing fallback behavior; change only if tests expose a gap.
- Optionally modify `.env.example`: make queued mode guidance explicit after UI behavior is stable.

## Task 1: Add Row-Level Analysis State UI

**Files:**
- Modify: `src/components/queue/QueueTable.tsx`
- Test: `src/components/queue/QueueTable.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests that render two waiting rows with independent analysis states:

```tsx
it("renders independent analysis states for multiple queued rows", () => {
  render(
    <QueueTable
      rows={[
        { ...baseRow, id: "RC-2026-001", title: "첫 번째 분석" },
        { ...baseRow, id: "RC-2026-002", title: "두 번째 분석" }
      ]}
      activeRole="reviewer"
      analysisStates={{
        "RC-2026-001": { status: "queued" },
        "RC-2026-002": { status: "running" }
      }}
      onStartAnalysis={() => undefined}
      onOpenReview={() => undefined}
    />
  );

  expect(within(screen.getByRole("row", { name: /첫 번째 분석/ })).getByRole("button", { name: "대기중" })).toBeDisabled();
  expect(within(screen.getByRole("row", { name: /두 번째 분석/ })).getByRole("button", { name: "분석중" })).toBeDisabled();
});

it("shows failed analysis rows as retryable with error detail", () => {
  render(
    <QueueTable
      rows={[baseRow]}
      activeRole="reviewer"
      analysisStates={{
        [baseRow.id]: { status: "failed", errorMessage: "Cohere rerank failed: 400 Bad Request" }
      }}
      onStartAnalysis={() => undefined}
      onOpenReview={() => undefined}
    />
  );

  expect(screen.getByRole("button", { name: "AI 분석 재시도" })).toBeInTheDocument();
  expect(screen.getByText("분석 실패: Cohere rerank failed: 400 Bad Request")).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npx vitest run src/components/queue/QueueTable.test.tsx -t "analysis"
```

Expected: fail because `analysisStates` prop does not exist and the table only accepts `activeAnalysisId`.

- [ ] **Step 3: Implement minimal UI state support**

Add exported types:

```ts
export type QueueAnalysisState = {
  status: "queued" | "running" | "completed" | "failed";
  errorMessage?: string;
};

export type QueueAnalysisStates = Record<string, QueueAnalysisState | undefined>;
```

Replace `activeAnalysisId` prop with:

```ts
analysisStates?: QueueAnalysisStates;
```

Render action labels:

- `queued`: disabled button with `대기중`.
- `running`: disabled button with `분석중`.
- `failed`: enabled retry button with `AI 분석 재시도` and visible error text.
- no state: existing `AI 분석 시작`.

- [ ] **Step 4: Verify table tests pass**

Run:

```bash
npx vitest run src/components/queue/QueueTable.test.tsx
```

Expected: pass.

## Task 2: Poll Analysis Status Instead of Review Status

**Files:**
- Modify: `src/components/ReviewQueue.tsx`
- Test: `src/components/ReviewQueue.test.tsx`

- [ ] **Step 1: Write failing integration tests**

Add a test that starts two rows and receives one running and one failed status:

```tsx
it("tracks multiple analysis jobs independently and shows failed job retry state", async () => {
  vi.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const first = { ...reviewSummaries[1], id: "rc-upload-001", title: "첫 번째 업로드" };
  const second = { ...reviewSummaries[1], id: "rc-upload-002", title: "두 번째 업로드" };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ reviewCases: [first, second] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ reviewCaseId: first.id, status: "analysis_queued", jobId: "job-1", issueCount: 0, analysisHref: `/reviews/${first.id}` }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ reviewCaseId: second.id, status: "analysis_queued", jobId: "job-2", issueCount: 0, analysisHref: `/reviews/${second.id}` }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ reviewCaseId: first.id, status: "running", progress: 20, currentStep: "worker_running", jobId: "job-1" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ reviewCaseId: second.id, status: "failed", progress: 100, currentStep: "worker_failed", jobId: "job-2", errorMessage: "Cohere rerank failed: 400 Bad Request" }) });
  vi.stubGlobal("fetch", fetchMock);

  renderQueue("reviewer", "reviewer.jwt");

  await user.click(within(await screen.findByRole("row", { name: /첫 번째 업로드/ })).getByRole("button", { name: "AI 분석 시작" }));
  await user.click(within(await screen.findByRole("row", { name: /두 번째 업로드/ })).getByRole("button", { name: "AI 분석 시작" }));

  await vi.runOnlyPendingTimersAsync();

  expect(within(screen.getByRole("row", { name: /첫 번째 업로드/ })).getByRole("button", { name: "분석중" })).toBeDisabled();
  expect(within(screen.getByRole("row", { name: /두 번째 업로드/ })).getByRole("button", { name: "AI 분석 재시도" })).toBeInTheDocument();
  expect(screen.getByText("분석 실패: Cohere rerank failed: 400 Bad Request")).toBeInTheDocument();
  vi.useRealTimers();
});
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
npx vitest run src/components/ReviewQueue.test.tsx -t "tracks multiple analysis jobs"
```

Expected: fail because `ReviewQueue` uses one `activeAnalysisId` and polls `/api/v1/review-cases/:id`.

- [ ] **Step 3: Implement per-case job polling**

In `ReviewQueue.tsx`:

- Replace `activeAnalysisId` with `analysisStates`.
- Add `AnalysisStatusResponse` type matching `getAnalysisStatus()`.
- Poll `/api/v1/review-cases/${reviewId}/analysis/status`.
- Treat only `completed` and `failed` as terminal job statuses.
- On `completed`, fetch `/api/v1/review-cases/${reviewId}` once to refresh row status/actions.
- On `failed`, preserve `{ status: "failed", errorMessage }` in the state map.

- [ ] **Step 4: Verify queue tests pass**

Run:

```bash
npx vitest run src/components/ReviewQueue.test.tsx
```

Expected: pass.

## Task 3: Verify Provider Failure Isolation

**Files:**
- Test: `src/server/analysis/rerank-provider.test.ts`
- Modify: `src/server/analysis/rerank-provider.ts` only if necessary.

- [ ] **Step 1: Run existing rerank tests**

Run:

```bash
npx vitest run src/server/analysis/rerank-provider.test.ts
```

Expected: pass, including Cohere failure fallback.

- [ ] **Step 2: Add regression test if missing**

If no empty candidate test exists, add:

```ts
it("does not call Cohere when there are no RAG candidates", async () => {
  const fetchImpl = vi.fn();
  const reranker = createCohereReranker(
    {
      FINPROOF_RERANK_PROVIDER: "cohere",
      COHERE_API_KEY: "cohere-key",
      FINPROOF_RERANK_MODEL: "rerank-v3.5"
    },
    fetchImpl
  );

  await expect(reranker.rerank({ query: "최고금리", candidates: [] })).resolves.toEqual([]);
  expect(fetchImpl).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Verify regression test**

Run:

```bash
npx vitest run src/server/analysis/rerank-provider.test.ts
```

Expected: pass.

## Task 4: Final Verification

**Files:**
- No production changes unless test failures expose a real gap.

- [ ] **Step 1: Run focused test suite**

```bash
npx vitest run src/components/queue/QueueTable.test.tsx src/components/ReviewQueue.test.tsx src/server/analysis/rerank-provider.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no warnings or errors.

- [ ] **Step 3: Summarize operational behavior**

Confirm in the final notes:

- Multiple analysis jobs render independently.
- Failed jobs are visible and retryable.
- Polling uses analysis job status.
- Cohere rerank failures fall back instead of cancelling analysis.
