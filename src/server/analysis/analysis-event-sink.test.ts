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
