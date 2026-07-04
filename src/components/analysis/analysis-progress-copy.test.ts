import { describe, expect, it } from "vitest";
import { describeAnalysisEvent, buildProgressLines } from "./analysis-progress-copy";

function subagentEvent(seq: number, event: "start" | "done", agent: string, findings = 0) {
  return {
    id: `e${seq}`,
    seq,
    stage: "subagent",
    event,
    payload: event === "done" ? { agent, findings } : { agent },
    createdAt: "2026-07-04T00:00:00.000Z"
  };
}

describe("buildProgressLines", () => {
  it("hides a sub-agent's spinner once its done event has arrived", () => {
    const lines = buildProgressLines([
      subagentEvent(1, "start", "regulation"),
      subagentEvent(2, "start", "internal_policy"),
      subagentEvent(3, "done", "regulation", 3)
    ]);
    // regulation finished -> only its done line; internal_policy still running.
    const running = lines.filter((line) => line.state === "running");
    expect(running).toHaveLength(1);
    expect(running[0].text).toContain("내부 지침");
    expect(lines.some((line) => line.state === "done" && line.text.includes("규정"))).toBe(true);
    expect(lines.some((line) => line.state === "running" && line.text.includes("규정"))).toBe(false);
  });
});

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

  it("cleans nested archive paths and extensions into readable, deduped chips", () => {
    const line = describeAnalysisEvent({
      id: "e5",
      seq: 5,
      stage: "evidence_select",
      event: "done",
      payload: {
        selected: 3,
        titles: [
          "finproof_bank.zip/finproof_bank.zip/poster_daily_savings.png",
          "finproof_bank.zip/finproof_bank.zip/poster_daily_savings.png",
          "예금 적금 광고 심의 체크리스트"
        ]
      },
      createdAt: "2026-07-04T00:00:00.000Z"
    });
    expect(line.evidence).toEqual(["poster_daily_savings", "예금 적금 광고 심의 체크리스트"]);
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
