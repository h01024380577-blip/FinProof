import { parseAnalysisWorkerCliArgs } from "./run-analysis-worker";

describe("analysis worker CLI", () => {
  it("runs one job by default", () => {
    expect(parseAnalysisWorkerCliArgs([])).toEqual({
      loop: false,
      pollIntervalMs: 5000
    });
  });

  it("supports a long-running worker loop with a custom poll interval", () => {
    expect(parseAnalysisWorkerCliArgs(["--loop", "--poll-ms=250"])).toEqual({
      loop: true,
      pollIntervalMs: 250
    });
  });

  it("falls back to the default poll interval when the argument is invalid", () => {
    expect(parseAnalysisWorkerCliArgs(["--loop", "--poll-ms=0"])).toEqual({
      loop: true,
      pollIntervalMs: 5000
    });
  });
});
