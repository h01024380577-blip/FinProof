import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: {
    listAnalysisEvents: vi.fn()
  }
}));

vi.mock("@/server/reviews/review-service", () => ({
  createReviewService: () => mocks.service
}));

import { GET } from "./route";

function makeRequest(url: string) {
  return new Request(url, { headers: { "x-finproof-role": "reviewer" } });
}

describe("GET analysis/events", () => {
  it("returns events for the case and forwards the since cursor", async () => {
    mocks.service.listAnalysisEvents.mockResolvedValue({
      jobId: "job-1",
      status: "running",
      events: [
        {
          id: "evt-1",
          seq: 1,
          stage: "pipeline",
          event: "start",
          payload: {},
          createdAt: "2026-07-04T00:00:00.000Z"
        }
      ]
    });

    const response = await GET(
      makeRequest("http://localhost/api/v1/review-cases/rc-1/analysis/events?since=0"),
      { params: Promise.resolve({ caseId: "rc-1" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobId).toBe("job-1");
    expect(body.events).toHaveLength(1);
    expect(mocks.service.listAnalysisEvents.mock.calls[0][2]).toEqual({ since: 0 });
  });

  it("404s when the case is missing", async () => {
    mocks.service.listAnalysisEvents.mockResolvedValue(undefined);

    const response = await GET(
      makeRequest("http://localhost/api/v1/review-cases/rc-x/analysis/events"),
      { params: Promise.resolve({ caseId: "rc-x" }) }
    );

    expect(response.status).toBe(404);
  });
});
