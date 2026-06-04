# Analysis Queue Operational Hardening Design

## Goal

Make AI analysis robust for multiple queued review cases by treating analysis as a durable job workflow, showing per-row job state in the queue, and preventing recoverable provider failures from looking like user-initiated cancellations.

## Problem

When reviewers start AI analysis for multiple rows, later rows can appear to be cancelled. Investigation showed recent failed jobs with `Cohere rerank failed: 400 Bad Request`. Failed jobs reset the review case to `analysis_waiting`, and the queue UI treats `analysis_waiting` as a polling terminal state. This hides the failed job and makes the row look like analysis simply stopped.

There is also a UI modeling issue: `ReviewQueue` tracks only one `activeAnalysisId`, so multiple simultaneously queued or running analyses cannot be represented accurately.

## Design

Analysis start should be modeled as enqueueing durable work. The queue UI should render job state from `/api/v1/review-cases/:caseId/analysis/status`, not infer the state only from `ReviewCase.status`.

Review case status remains useful for workflow transitions:

- `analysis_waiting`: no active job, reviewer may start or retry analysis.
- `analysis_queued`: analysis request accepted and waiting for worker.
- `analysis_in_progress`: worker has claimed the job.
- `analysis_complete`: outputs persisted and review is ready.

Analysis job status is the authoritative status for the active run:

- `queued`: show "대기중".
- `running`: show "분석중".
- `completed`: fetch the review case and show "검토하기".
- `failed`: show "분석 실패" plus retry action and short error detail.

The UI must support many active jobs at once with a map keyed by review case id. It must not clear all active indicators when one job completes.

## Provider Failure Policy

Recoverable provider failures should not fail the whole analysis:

- Rerank provider 4xx/5xx/network errors fall back to deterministic reranking.
- Empty RAG candidate lists skip provider rerank.
- OCR/model failures remain hard failures unless a deterministic fallback has enough source text to produce a defensible result.

Hard failures should be visible as failed jobs and should allow retry. Error messages should remain short and safe for UI display.

## Data Flow

1. Reviewer clicks `AI 분석 시작`.
2. UI calls `POST /api/v1/review-cases/:caseId/analysis/start`.
3. API enqueues an analysis job and returns `jobId`, `status`, and `analysisHref`.
4. UI records a per-case job state and starts polling `GET /api/v1/review-cases/:caseId/analysis/status`.
5. Worker claims and processes queued jobs.
6. UI updates the row based on job status.
7. On `completed`, UI fetches the review case once to refresh status and actions.
8. On `failed`, UI keeps the row in retryable state with visible failure detail.

## Error Handling

The analysis status endpoint is the only source for job failure display. If polling fails transiently, the UI keeps the current row state and retries. If polling exceeds the attempt limit while the job is still queued or running, the UI shows a timeout message but does not mark the analysis as cancelled.

`failAnalysisJob()` may continue resetting review case status to `analysis_waiting`, but the UI must preserve and show the latest failed job state.

## Testing

Add focused tests for:

- Starting multiple analyses leaves both rows in active queued/running states.
- One completed job and one failed job render independently.
- `analysis_waiting` is not treated as successful analysis completion when the latest job is failed.
- Failed job rows show retry copy and do not silently return to `AI 분석 시작`.
- Cohere rerank failure falls back to deterministic reranking.

## Rollout

First deploy the UI and API-state handling changes. Then run the worker with `FINPROOF_ANALYSIS_EXECUTION_MODE=queued` in development and production. Keep deterministic rerank fallback enabled so external rerank outages do not block analysis.
