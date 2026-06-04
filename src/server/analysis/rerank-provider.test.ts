import type { RagEvidenceCandidate } from "./review-analysis-pipeline";
import { createCohereReranker, createHttpReranker } from "./rerank-provider";

const candidates: RagEvidenceCandidate[] = [
  {
    id: "ev-1",
    sourceType: "internal_policy",
    title: "내부 체크리스트",
    quoteSummary: "우대 조건이 있는 경우 실제 적용 금리가 달라질 수 있음을 고지한다.",
    relevanceScore: 0.62
  },
  {
    id: "ev-2",
    sourceType: "law",
    title: "광고 표시 기준",
    quoteSummary: "최고금리 표시는 적용 조건을 인접 위치에 표시해야 한다.",
    relevanceScore: 0.58
  }
];

describe("Cohere reranker", () => {
  it("calls Cohere rerank and maps relevance_score by original document index", async () => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      fetchCalls.push({ input, init });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            results: [
              { index: 1, relevance_score: 0.97 },
              { index: 0, relevance_score: 0.51 }
            ]
          };
        }
      };
    });

    const reranker = createCohereReranker(
      {
        FINPROOF_RERANK_PROVIDER: "cohere",
        COHERE_API_KEY: "cohere-key",
        FINPROOF_RERANK_MODEL: "rerank-v3.5",
        FINPROOF_RERANK_TOP_K: "2"
      },
      fetchImpl
    );

    const ranked = await reranker.rerank({
      query: "최고금리 표시 조건",
      candidates
    });

    expect(reranker.provider).toBe("rerank-v3.5");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].input).toBe("https://api.cohere.com/v1/rerank");
    expect(fetchCalls[0].init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer cohere-key"
    });
    expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({
      model: "rerank-v3.5",
      query: "최고금리 표시 조건",
      documents: [
        {
          text: candidates[0].quoteSummary,
          title: candidates[0].title,
          sourceType: candidates[0].sourceType
        },
        {
          text: candidates[1].quoteSummary,
          title: candidates[1].title,
          sourceType: candidates[1].sourceType
        }
      ],
      top_n: 2,
      return_documents: false
    });
    expect(ranked).toEqual([
      { ...candidates[1], relevanceScore: 0.97 },
      { ...candidates[0], relevanceScore: 0.51 }
    ]);
  });

  it("falls back to deterministic reranking when Cohere fails", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      async json() {
        return {};
      }
    }));
    const reranker = createCohereReranker(
      {
        FINPROOF_RERANK_PROVIDER: "cohere",
        COHERE_API_KEY: "cohere-key",
        FINPROOF_RERANK_MODEL: "rerank-v3.5",
        FINPROOF_RERANK_TOP_K: "2"
      },
      fetchImpl
    );

    const ranked = await reranker.rerank({
      query: "최고금리 표시 조건",
      candidates
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(ranked).toEqual([
      expect.objectContaining({ id: "ev-2" }),
      expect.objectContaining({ id: "ev-1" })
    ]);
  });

  it("falls back to deterministic reranking when HTTP rerank fails", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      async json() {
        return {};
      }
    }));
    const reranker = createHttpReranker(
      {
        FINPROOF_RERANK_PROVIDER: "http",
        FINPROOF_RERANK_ENDPOINT: "https://rerank.example.com",
        FINPROOF_RERANK_MODEL: "bge-reranker-v2-m3",
        FINPROOF_RERANK_TOP_K: "2"
      },
      fetchImpl
    );

    const ranked = await reranker.rerank({
      query: "최고금리 표시 조건",
      candidates
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(ranked).toEqual([
      expect.objectContaining({ id: "ev-2" }),
      expect.objectContaining({ id: "ev-1" })
    ]);
  });
});
