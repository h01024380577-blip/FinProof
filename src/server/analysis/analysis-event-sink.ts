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
