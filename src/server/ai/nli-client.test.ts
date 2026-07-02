import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpNliClient } from "./nli-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createHttpNliClient", () => {
  it("posts premise/hypothesis and returns normalized scores", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ scores: { entailment: 0.1, neutral: 0.2, contradiction: 0.7 } })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpNliClient({ baseUrl: "http://localhost:8001" });
    const scores = await client.classify({ premise: "가", hypothesis: "나" });

    expect(scores).toEqual({ entailment: 0.1, neutral: 0.2, contradiction: 0.7 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8001/nli",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws when the service responds with a non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const client = createHttpNliClient({ baseUrl: "http://localhost:8001" });
    await expect(client.classify({ premise: "가", hypothesis: "나" })).rejects.toThrow();
  });
});
