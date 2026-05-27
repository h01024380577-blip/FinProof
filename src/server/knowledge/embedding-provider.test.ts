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

  it("prefers a dedicated embedding API key over the shared OpenAI key", async () => {
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
        authorization: "Bearer sk-embedding"
      })
    );
  });

  it("selects OpenAI embeddings when provider is openai or an OpenAI key is present", () => {
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
});
