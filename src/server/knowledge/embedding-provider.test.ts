// @vitest-environment node

import {
  createEmbeddingProvider,
  createOpenAiEmbeddingProvider,
  type EmbeddingProvider
} from "./embedding-provider";

describe("embedding provider", () => {
  it("calls the OpenAI embeddings API with OPENAI_API_KEY", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }]
      })
    }));
    const provider = createOpenAiEmbeddingProvider(
      {
        OPENAI_API_KEY: "sk-test",
        FINPROOF_EMBEDDING_MODEL: "text-embedding-3-small"
      },
      fetchMock
    );

    await expect(provider.embed(["예금 금리", "대출 조건"])).resolves.toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6]
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          authorization: "Bearer sk-test"
        })
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      model: "text-embedding-3-small",
      input: ["예금 금리", "대출 조건"]
    });
  });

  it("splits oversized chunk sets into multiple requests and preserves order", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { input: string[] };
      return {
        ok: true,
        json: async () => ({
          data: body.input.map((_text, index) => ({ embedding: [index] }))
        })
      };
    });
    const provider = createOpenAiEmbeddingProvider({ OPENAI_API_KEY: "sk-test" }, fetchMock);

    // Each chunk is ~300k chars (~270k est. tokens), so no two fit in one request.
    const huge = "가".repeat(300_000);
    const result = await provider.embed([huge, huge, huge]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(3);
    fetchMock.mock.calls.forEach((call) => {
      expect(JSON.parse(call[1]?.body as string).input).toHaveLength(1);
    });
  });

  it("uses the shared OpenAI key even when an embedding-specific key is present", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1] }]
      })
    }));
    const provider = createOpenAiEmbeddingProvider(
      {
        OPENAI_API_KEY: "sk-openai",
        FINPROOF_EMBEDDING_API_KEY: "sk-embedding"
      },
      fetchMock
    );

    await provider.embed(["심의 지침"]);

    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer sk-openai"
      })
    );
  });

  it("selects OpenAI embeddings when provider is openai or the shared OpenAI key is present", () => {
    expect(
      createEmbeddingProvider({
        FINPROOF_EMBEDDING_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test"
      }).model
    ).toBe("text-embedding-3-small");
    expect(
      createEmbeddingProvider({
        OPENAI_API_KEY: "sk-test",
        FINPROOF_EMBEDDING_MODEL: "text-embedding-3-large"
      }).model
    ).toBe("text-embedding-3-large");
    expect(
      createEmbeddingProvider({
        FINPROOF_EMBEDDING_API_KEY: "sk-embedding"
      }).model
    ).toBe("deterministic-embedding");
  });

  it("keeps deterministic embeddings when explicitly selected", async () => {
    const provider: EmbeddingProvider = createEmbeddingProvider({
      FINPROOF_EMBEDDING_PROVIDER: "deterministic",
      OPENAI_API_KEY: "sk-test"
    });

    await expect(provider.embed(["같은 문장"])).resolves.toHaveLength(1);
    expect(provider.model).toBe("deterministic-embedding");
  });

  it("requires an OpenAI key for the OpenAI embedding provider", () => {
    expect(() => createOpenAiEmbeddingProvider({})).toThrow(
      "OPENAI_API_KEY is required when embeddings use OpenAI"
    );
  });

  it("surfaces the OpenAI error message and a key hint on 401 without retrying", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
      text: async () =>
        JSON.stringify({ error: { message: "Incorrect API key provided: sk-***." } })
    }));
    const provider = createOpenAiEmbeddingProvider({ OPENAI_API_KEY: "sk-bad" }, fetchMock);

    await expect(provider.embed(["근거 질의"])).rejects.toThrow(
      /401 Unauthorized - Incorrect API key provided.*OPENAI_API_KEY/s
    );
    // 401 is not transient: it must fail on the first attempt only.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient 429 responses and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({}),
        text: async () => "rate limited"
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }] })
      });
    const provider = createOpenAiEmbeddingProvider({ OPENAI_API_KEY: "sk-test" }, fetchMock);

    await expect(provider.embed(["재시도"])).resolves.toEqual([[0.1, 0.2]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
