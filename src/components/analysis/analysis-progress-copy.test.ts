import { describe, expect, it } from "vitest";
import { describeAnalysisEvent } from "./analysis-progress-copy";

describe("describeAnalysisEvent", () => {
  it("humanizes ocr done", () => {
    const line = describeAnalysisEvent({
      id: "e1",
      seq: 1,
      stage: "ocr",
      event: "done",
      payload: { docs: 3 },
      createdAt: "2026-07-04T00:00:00.000Z"
    });
    expect(line.text).toContain("3");
    expect(line.state).toBe("done");
  });

  it("labels a subagent start with a friendly name and running state", () => {
    const line = describeAnalysisEvent({
      id: "e2",
      seq: 2,
      stage: "subagent",
      event: "start",
      payload: { agent: "regulation" },
      createdAt: "2026-07-04T00:00:00.000Z"
    });
    expect(line.text).toContain("규정");
    expect(line.state).toBe("running");
  });

  it("exposes evidence chips on rerank done", () => {
    const line = describeAnalysisEvent({
      id: "e3",
      seq: 3,
      stage: "rerank",
      event: "done",
      payload: { topDocs: [{ title: "전자금융감독규정 §5", score: 0.71 }] },
      createdAt: "2026-07-04T00:00:00.000Z"
    });
    expect(line.evidence).toEqual(["전자금융감독규정 §5"]);
  });

  it("falls back safely for unknown stages", () => {
    const line = describeAnalysisEvent({
      id: "e4",
      seq: 4,
      stage: "mystery",
      event: "poke",
      payload: {},
      createdAt: "2026-07-04T00:00:00.000Z"
    });
    expect(line.text.length).toBeGreaterThan(0);
    expect(line.state).toBe("info");
  });
});
