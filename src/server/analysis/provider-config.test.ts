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
});
