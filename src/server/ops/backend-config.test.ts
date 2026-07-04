import {
  assertBackendDeploymentReady,
  assertBackendProductionReady,
  getBackendRuntimeConfig,
  getBackendReadinessProfile,
  redactedBackendRuntimeConfig
} from "./backend-config";

describe("backend runtime config", () => {
  it("defaults to deterministic local providers", () => {
    const config = getBackendRuntimeConfig({});

    expect(config.auth.mode).toBe("demo");
    expect(config.reviewStore.provider).toBe("mock");
    expect(config.model.provider).toBe("deterministic");
    expect(config.embedding.provider).toBe("deterministic");
    expect(config.ocr.provider).toBe("deterministic");
    expect(config.rag.provider).toBe("deterministic");
    expect(config.rerank.provider).toBe("deterministic");
    expect(config.uploadScan.provider).toBe("deterministic");
    expect(config.storage.provider).toBe("local-metadata");
    expect(config.productionGaps).toEqual(
      expect.arrayContaining([
        "FINPROOF_AUTH_MODE=jwt",
        "FINPROOF_REVIEW_STORE=prisma",
        "FINPROOF_MODEL_PROVIDER=router|anthropic|openai",
        "FINPROOF_EMBEDDING_PROVIDER=openai",
        "FINPROOF_OCR_PROVIDER=openai|gemini|http",
        "FINPROOF_RAG_PROVIDER=postgres",
        "FINPROOF_RERANK_PROVIDER=cohere",
        "FINPROOF_UPLOAD_SCAN_PROVIDER=http",
        "FINPROOF_STORAGE_ADAPTER=s3"
      ])
    );
    expect(config.deploymentWarnings).toEqual(config.productionGaps);
    expect(config.deploymentReady).toBe(true);
    expect(config.productionReady).toBe(false);
  });

  it("allows deployment readiness with deterministic local providers as warnings", () => {
    const config = getBackendRuntimeConfig({});

    expect(() => assertBackendDeploymentReady(config)).not.toThrow();
    expect(config.deploymentReady).toBe(true);
    expect(config.deploymentWarnings).toEqual(
      expect.arrayContaining([
        "FINPROOF_AUTH_MODE=jwt",
        "FINPROOF_REVIEW_STORE=prisma",
        "FINPROOF_MODEL_PROVIDER=router|anthropic|openai",
        "FINPROOF_STORAGE_ADAPTER=s3"
      ])
    );
    expect(() => assertBackendProductionReady(config)).toThrow(
      /Backend production readiness failed/
    );
  });

  it("fails deployment readiness when a selected external provider is missing required config", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_UPLOAD_SCAN_PROVIDER: "http"
    });

    expect(config.deploymentReady).toBe(false);
    expect(config.missing).toContain("FINPROOF_UPLOAD_SCAN_ENDPOINT");
    expect(() => assertBackendDeploymentReady(config)).toThrow(
      /Backend deployment readiness failed: FINPROOF_UPLOAD_SCAN_ENDPOINT/
    );
  });

  it("reads the requested readiness profile from env", () => {
    expect(getBackendReadinessProfile({})).toBe("deployment");
    expect(getBackendReadinessProfile({ FINPROOF_READINESS_PROFILE: "deployment" })).toBe(
      "deployment"
    );
    expect(getBackendReadinessProfile({ FINPROOF_READINESS_PROFILE: "production" })).toBe(
      "production"
    );
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
        "FINPROOF_MODEL_PROVIDER=router|anthropic|openai",
        "FINPROOF_EMBEDDING_PROVIDER=openai",
        "FINPROOF_OCR_PROVIDER=openai|gemini|http",
        "FINPROOF_RAG_PROVIDER=postgres",
        "FINPROOF_RERANK_PROVIDER=cohere",
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
      FINPROOF_OCR_PROVIDER: "gemini",
      FINPROOF_RAG_PROVIDER: "postgres",
      FINPROOF_RERANK_PROVIDER: "cohere",
      FINPROOF_UPLOAD_SCAN_PROVIDER: "http",
      FINPROOF_STORAGE_ADAPTER: "s3"
    });

    expect(config.missing).toEqual(
      expect.arrayContaining([
        "FINPROOF_AUTH_JWT_SECRET",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "COHERE_API_KEY",
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

  it("requires a Cohere API key when Cohere rerank is enabled", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_RERANK_PROVIDER: "cohere"
    });

    expect(config.rerank).toEqual({
      provider: "cohere",
      configured: false,
      model: "rerank-v4.0-pro"
    });
    expect(config.missing).toContain("COHERE_API_KEY");
  });

  it("configures Gemini OCR with the shared Gemini API key", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_OCR_PROVIDER: "gemini",
      GEMINI_API_KEY: "gemini-real",
      FINPROOF_OCR_MODEL: "gemini-2.5-flash-lite"
    });

    expect(config.ocr).toEqual({
      provider: "gemini",
      configured: true,
      model: "gemini-2.5-flash-lite"
    });
    expect(config.missing).not.toContain("GEMINI_API_KEY");
    expect(config.productionGaps).not.toContain("FINPROOF_OCR_PROVIDER=openai|gemini|http");
  });

  it("configures OpenAI OCR with the shared OpenAI API key", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_OCR_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-real",
      FINPROOF_OCR_MODEL: "gpt-5-mini"
    });

    expect(config.ocr).toEqual({
      provider: "openai",
      configured: true,
      model: "gpt-5-mini"
    });
    expect(config.missing).not.toContain("OPENAI_API_KEY");
    expect(config.productionGaps).not.toContain("FINPROOF_OCR_PROVIDER=openai|gemini|http");
  });

  it("requires an OpenAI key when OpenAI embeddings are selected", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_EMBEDDING_PROVIDER: "openai"
    });

    expect(config.embedding).toEqual({
      provider: "openai",
      configured: false,
      model: "text-embedding-3-small"
    });
    expect(config.missing).toContain("OPENAI_API_KEY");
  });

  it("uses the shared OpenAI key for OpenAI embeddings", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-openai",
      FINPROOF_EMBEDDING_MODEL: "text-embedding-3-large"
    });

    expect(config.embedding).toEqual({
      provider: "openai",
      configured: true,
      model: "text-embedding-3-large"
    });
    expect(config.missing).not.toContain("OPENAI_API_KEY");
  });

  it("does not configure OpenAI embeddings with an embedding-specific key alone", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_EMBEDDING_PROVIDER: "openai",
      FINPROOF_EMBEDDING_API_KEY: "sk-embedding"
    });

    expect(config.embedding).toEqual({
      provider: "openai",
      configured: false,
      model: "text-embedding-3-small"
    });
    expect(config.missing).toContain("OPENAI_API_KEY");
  });

  it("redacts secrets before exposing readiness", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_AUTH_JWT_SECRET: "super-secret",
      FINPROOF_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-real",
      OPENAI_MODEL: "gpt-5.2"
    });

    expect(redactedBackendRuntimeConfig(config).secrets).toEqual({
      FINPROOF_AUTH_JWT_SECRET: "set",
      OPENAI_API_KEY: "set"
    });
  });

  it("does not allow Gemini as a non-OCR model provider", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_AUTH_JWT_SECRET: "super-secret",
      FINPROOF_MODEL_PROVIDER: "gemini"
    });

    expect(config.model.provider).toBe("deterministic");
    expect(config.productionGaps).toContain("FINPROOF_MODEL_PROVIDER=router|anthropic|openai");
  });

  it("requires the Anthropic key for router mode and exposes Claude defaults", () => {
    const config = getBackendRuntimeConfig({
      FINPROOF_AUTH_MODE: "jwt",
      FINPROOF_AUTH_JWT_SECRET: "super-secret",
      FINPROOF_MODEL_PROVIDER: "router",
      OPENAI_API_KEY: "sk-real"
    });

    expect(config.model.provider).toBe("router");
    expect(config.model).toMatchObject({
      defaultTextModel: "claude-sonnet-5",
      escalationTextModel: "claude-sonnet-5",
      highestPrecisionTextModel: "claude-opus-4-8"
    });
    // Text now routes to Claude, so router mode needs the Anthropic key even when
    // an OpenAI key is present (the latter still covers embeddings).
    expect(config.missing).toContain("ANTHROPIC_API_KEY");
    expect(config.missing).not.toContain("GEMINI_API_KEY");
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
      ANTHROPIC_API_KEY: "sk-ant-real",
      OPENAI_API_KEY: "sk-real",
      FINPROOF_EMBEDDING_PROVIDER: "openai",
      FINPROOF_OCR_PROVIDER: "openai",
      FINPROOF_OCR_MODEL: "gpt-5-mini",
      FINPROOF_RAG_PROVIDER: "postgres",
      FINPROOF_RERANK_PROVIDER: "cohere",
      COHERE_API_KEY: "cohere-real",
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
