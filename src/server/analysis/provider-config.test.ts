import { getAnalysisProviderConfig } from "./provider-config";

describe("analysis provider config", () => {
  it("defaults OCR and RAG to deterministic providers", () => {
    const config = getAnalysisProviderConfig({});

    expect(config.ocr).toEqual({ provider: "deterministic" });
    expect(config.rag).toEqual({
      provider: "deterministic",
      topK: 4,
      minScore: 0.72,
      maxContextChars: 6000
    });
    expect(config.rerank).toEqual({
      provider: "deterministic",
      model: "deterministic-reranker",
      topK: 4
    });
  });

  it("requires HTTP OCR endpoint configuration", () => {
    const config = getAnalysisProviderConfig({ FINPROOF_OCR_PROVIDER: "http" });

    expect(config.ocr).toEqual({
      provider: "http",
      endpoint: undefined,
      apiKeyConfigured: false
    });
    expect(config.missing).toContain("FINPROOF_OCR_ENDPOINT");
  });

  it("uses Gemini OCR with the shared Gemini API key", () => {
    const config = getAnalysisProviderConfig({
      FINPROOF_OCR_PROVIDER: "gemini",
      GEMINI_API_KEY: "gemini-real",
      FINPROOF_OCR_MODEL: "gemini-2.5-flash-lite"
    });

    expect(config.ocr).toEqual({
      provider: "gemini",
      apiKeyConfigured: true,
      model: "gemini-2.5-flash-lite"
    });
    expect(config.missing).not.toContain("GEMINI_API_KEY");
  });

  it("requires the shared Gemini API key when Gemini OCR is enabled", () => {
    const config = getAnalysisProviderConfig({ FINPROOF_OCR_PROVIDER: "gemini" });

    expect(config.ocr).toEqual({
      provider: "gemini",
      apiKeyConfigured: false,
      model: "gemini-2.5-flash-lite"
    });
    expect(config.missing).toContain("GEMINI_API_KEY");
  });

  it("parses RAG tuning knobs", () => {
    const config = getAnalysisProviderConfig({
      FINPROOF_RAG_PROVIDER: "postgres",
      DATABASE_URL: "postgresql://example",
      FINPROOF_RAG_TOP_K: "8",
      FINPROOF_RAG_MIN_SCORE: "0.81",
      FINPROOF_RAG_MAX_CONTEXT_CHARS: "12000"
    });

    expect(config.rag).toEqual({
      provider: "postgres",
      databaseConfigured: true,
      topK: 8,
      minScore: 0.81,
      maxContextChars: 12000
    });
  });

  it("requires an HTTP rerank endpoint when model rerank is enabled", () => {
    const config = getAnalysisProviderConfig({
      FINPROOF_RERANK_PROVIDER: "http",
      FINPROOF_RERANK_MODEL: "bge-reranker-v2-m3"
    });

    expect(config.rerank).toEqual({
      provider: "http",
      endpoint: undefined,
      apiKeyConfigured: false,
      model: "bge-reranker-v2-m3",
      topK: 4
    });
    expect(config.missing).toContain("FINPROOF_RERANK_ENDPOINT");
  });

  it("requires a Cohere API key when Cohere rerank is enabled", () => {
    const config = getAnalysisProviderConfig({
      FINPROOF_RERANK_PROVIDER: "cohere",
      FINPROOF_RERANK_TOP_K: "3"
    });

    expect(config.rerank).toEqual({
      provider: "cohere",
      apiKeyConfigured: false,
      model: "rerank-v3.5",
      topK: 3
    });
    expect(config.missing).toContain("COHERE_API_KEY");
  });
});
