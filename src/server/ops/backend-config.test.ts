import {
  assertBackendProductionReady,
  getBackendRuntimeConfig,
  redactedBackendRuntimeConfig
} from "./backend-config";

describe("backend runtime config", () => {
  it("defaults to deterministic local providers", () => {
    const config = getBackendRuntimeConfig({});

    expect(config.auth.mode).toBe("demo");
    expect(config.reviewStore.provider).toBe("mock");
    expect(config.model.provider).toBe("deterministic");
    expect(config.ocr.provider).toBe("deterministic");
    expect(config.rag.provider).toBe("deterministic");
    expect(config.rerank.provider).toBe("deterministic");
    expect(config.uploadScan.provider).toBe("deterministic");
    expect(config.storage.provider).toBe("local-metadata");
    expect(config.productionGaps).toEqual(
      expect.arrayContaining([
        "FINPROOF_AUTH_MODE=jwt",
        "FINPROOF_REVIEW_STORE=prisma",
        "FINPROOF_MODEL_PROVIDER=router|openai|gemini",
        "FINPROOF_OCR_PROVIDER=http",
        "FINPROOF_RAG_PROVIDER=postgres",
        "FINPROOF_RERANK_PROVIDER=http",
        "FINPROOF_UPLOAD_SCAN_PROVIDER=http",
        "FINPROOF_STORAGE_ADAPTER=s3"
      ])
    );
    expect(config.productionReady).toBe(false);
  });

  it("does not treat JWT-only configuration as production ready", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_AUTH_JWT_SECRET: "super-secret"
    });

    expect(config.missing).toEqual([]);
    expect(config.productionGaps).toEqual(
      expect.arrayContaining([
        "FINPROOF_REVIEW_STORE=prisma",
        "FINPROOF_MODEL_PROVIDER=router|openai|gemini",
        "FINPROOF_OCR_PROVIDER=http",
        "FINPROOF_RAG_PROVIDER=postgres",
        "FINPROOF_RERANK_PROVIDER=http",
        "FINPROOF_UPLOAD_SCAN_PROVIDER=http",
        "FINPROOF_STORAGE_ADAPTER=s3"
      ])
    );
    expect(config.productionReady).toBe(false);
  });

  it("reports missing production variables", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_MODEL_PROVIDER: "openai",
      FINPROOF_OCR_PROVIDER: "http",
      FINPROOF_RAG_PROVIDER: "postgres",
      FINPROOF_RERANK_PROVIDER: "http",
      FINPROOF_UPLOAD_SCAN_PROVIDER: "http",
      FINPROOF_STORAGE_ADAPTER: "s3"
    });

    expect(config.missing).toEqual(
      expect.arrayContaining([
        "FINPROOF_AUTH_JWT_SECRET",
        "OPENAI_API_KEY",
        "FINPROOF_OCR_ENDPOINT",
        "FINPROOF_RERANK_ENDPOINT",
        "FINPROOF_UPLOAD_SCAN_ENDPOINT",
        "DATABASE_URL",
        "FINPROOF_S3_BUCKET",
        "AWS_REGION"
      ])
    );
    expect(() => assertBackendProductionReady(config)).toThrow(
      /Backend production readiness failed/
    );
  });

  it("requires a runtime database URL for the Prisma review store", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_AUTH_JWT_SECRET: "super-secret",
      FINPROOF_REVIEW_STORE: "prisma"
    });

    expect(config.reviewStore).toEqual({
      provider: "prisma",
      configured: false
    });
    expect(config.missing).toContain("DATABASE_URL");
  });

  it("deduplicates the shared database requirement", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_REVIEW_STORE: "prisma",
      FINPROOF_RAG_PROVIDER: "postgres"
    });

    expect(config.missing.filter((key) => key === "DATABASE_URL")).toHaveLength(1);
  });

  it("requires a tenant id for queued analysis workers", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_ANALYSIS_EXECUTION_MODE: "queued"
    });

    expect(config.analysis).toEqual({
      executionMode: "queued",
      configured: false
    });
    expect(config.missing).toContain("FINPROOF_WORKER_TENANT_ID");
  });

  it("requires an HTTP upload scan endpoint when malware scanning is enabled", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_UPLOAD_SCAN_PROVIDER: "http"
    });

    expect(config.uploadScan).toEqual({
      provider: "http",
      configured: false
    });
    expect(config.missing).toContain("FINPROOF_UPLOAD_SCAN_ENDPOINT");
  });

  it("requires an HTTP rerank endpoint when RAG reranking is enabled", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_RERANK_PROVIDER: "http"
    });

    expect(config.rerank).toEqual({
      provider: "http",
      configured: false,
      model: "bge-reranker-v2-m3"
    });
    expect(config.missing).toContain("FINPROOF_RERANK_ENDPOINT");
  });

  it("redacts secrets before exposing readiness", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_AUTH_JWT_SECRET: "super-secret",
      FINPROOF_MODEL_PROVIDER: "gemini",
      GEMINI_API_KEY: "gemini-real",
      GEMINI_MODEL: "gemini-2.5-flash"
    });

    expect(redactedBackendRuntimeConfig(config).secrets).toEqual({
      FINPROOF_AUTH_JWT_SECRET: "set",
      GEMINI_API_KEY: "set"
    });
  });

  it("requires Gemini API key when Gemini provider is selected", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_AUTH_JWT_SECRET: "super-secret",
      FINPROOF_MODEL_PROVIDER: "gemini"
    });

    expect(config.model.provider).toBe("gemini");
    expect(config.missing).toContain("GEMINI_API_KEY");
  });

  it("requires both text and multimodal keys for router mode", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_AUTH_JWT_SECRET: "super-secret",
      FINPROOF_MODEL_PROVIDER: "router",
      OPENAI_API_KEY: "sk-real"
    });

    expect(config.model.provider).toBe("router");
    expect(config.model).toMatchObject({
      defaultTextModel: "gpt-5-mini",
      escalationTextModel: "gpt-5.4",
      multimodalModel: "gemini-2.5-flash"
    });
    expect(config.missing).toContain("GEMINI_API_KEY");
  });

  it("accepts JWKS auth with issuer and audience instead of a shared secret", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_AUTH_JWKS_URL: "https://auth.example.com/.well-known/jwks.json",
      FINPROOF_AUTH_JWT_ISSUER: "https://auth.example.com/",
      FINPROOF_AUTH_JWT_AUDIENCE: "finproof-agent",
      FINPROOF_REVIEW_STORE: "prisma",
      DATABASE_URL: "postgresql://runtime",
      FINPROOF_MODEL_PROVIDER: "router",
      OPENAI_API_KEY: "sk-real",
      GEMINI_API_KEY: "gemini-real",
      FINPROOF_OCR_PROVIDER: "http",
      FINPROOF_OCR_ENDPOINT: "https://ocr.example.com/extract",
      FINPROOF_RAG_PROVIDER: "postgres",
      FINPROOF_RERANK_PROVIDER: "http",
      FINPROOF_RERANK_ENDPOINT: "https://rerank.example.com/rerank",
      FINPROOF_UPLOAD_SCAN_PROVIDER: "http",
      FINPROOF_UPLOAD_SCAN_ENDPOINT: "https://scanner.example.com/scan",
      FINPROOF_STORAGE_ADAPTER: "s3",
      FINPROOF_S3_BUCKET: "finproof-s3",
      AWS_REGION: "us-east-1"
    });

    expect(config.auth).toEqual({
      mode: "jwt",
      provider: "jwks",
      configured: true
    });
    expect(config.missing).not.toContain("FINPROOF_AUTH_JWT_SECRET");
    expect(config.productionGaps).toEqual([]);
    expect(config.productionReady).toBe(true);
  });
});
