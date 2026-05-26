import { getModelRoutingConfig, type ModelRoutingConfig } from "@/server/ai/model-router";

type Env = Record<string, string | undefined>;

type ProviderState = {
  provider: string;
  configured: boolean;
};

export type BackendRuntimeConfig = {
  auth: {
    mode: "demo" | "jwt";
    provider: "demo" | "hs256" | "jwks" | "missing";
    configured: boolean;
  };
  reviewStore: ProviderState;
  analysis: {
    executionMode: "inline" | "queued";
    configured: boolean;
  };
  model: ProviderState &
    Partial<ModelRoutingConfig> & {
      model?: string;
    };
  ocr: ProviderState;
  rag: ProviderState & {
    topK: number;
    minScore: number;
    maxContextChars: number;
  };
  rerank: ProviderState & {
    model: string;
  };
  uploadScan: ProviderState;
  storage: ProviderState & {
    bucket?: string;
    region?: string;
  };
  secrets: Record<string, "set" | "missing">;
  missing: string[];
  productionGaps: string[];
  productionReady: boolean;
};

function value(env: Env, key: string): string | undefined {
  const raw = env[key];

  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function numberValue(env: Env, key: string, fallback: number): number {
  const raw = value(env, key);
  const parsed = raw ? Number(raw) : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function secretState(env: Env, key: string): "set" | "missing" {
  return value(env, key) ? "set" : "missing";
}

function requireWhen(missing: string[], condition: boolean, env: Env, key: string) {
  if (condition && !value(env, key) && !missing.includes(key)) {
    missing.push(key);
  }
}

function requireProductionProvider(gaps: string[], condition: boolean, expected: string) {
  if (condition && !gaps.includes(expected)) {
    gaps.push(expected);
  }
}

export function getBackendRuntimeConfig(env: Env = process.env): BackendRuntimeConfig {
  const missing: string[] = [];
  const productionGaps: string[] = [];
  const authMode = value(env, "FINPROOF_AUTH_MODE") === "jwt" ? "jwt" : "demo";
  const authProvider =
    authMode === "demo"
      ? "demo"
      : value(env, "FINPROOF_AUTH_JWKS_URL")
        ? "jwks"
        : value(env, "FINPROOF_AUTH_JWT_SECRET")
          ? "hs256"
          : "missing";
  const reviewStore = value(env, "FINPROOF_REVIEW_STORE") === "prisma" ? "prisma" : "mock";
  const modelProviderValue = value(env, "FINPROOF_MODEL_PROVIDER");
  const modelProvider =
    modelProviderValue === "openai" ||
    modelProviderValue === "gemini" ||
    modelProviderValue === "router"
      ? modelProviderValue
      : "deterministic";
  const ocrProvider = value(env, "FINPROOF_OCR_PROVIDER") === "http" ? "http" : "deterministic";
  const ragProvider =
    value(env, "FINPROOF_RAG_PROVIDER") === "postgres" ? "postgres" : "deterministic";
  const rerankProvider =
    value(env, "FINPROOF_RERANK_PROVIDER") === "http" ? "http" : "deterministic";
  const rerankModel = value(env, "FINPROOF_RERANK_MODEL") ?? "bge-reranker-v2-m3";
  const analysisExecutionMode =
    value(env, "FINPROOF_ANALYSIS_EXECUTION_MODE") === "queued" ? "queued" : "inline";
  const uploadScanProvider =
    value(env, "FINPROOF_UPLOAD_SCAN_PROVIDER") === "http" ? "http" : "deterministic";
  const storageProvider = value(env, "FINPROOF_STORAGE_ADAPTER") === "s3" ? "s3" : "local-metadata";

  requireWhen(
    missing,
    authMode === "jwt" && authProvider === "missing",
    env,
    "FINPROOF_AUTH_JWT_SECRET"
  );
  requireWhen(
    missing,
    authMode === "jwt" && authProvider === "jwks",
    env,
    "FINPROOF_AUTH_JWT_ISSUER"
  );
  requireWhen(
    missing,
    authMode === "jwt" && authProvider === "jwks",
    env,
    "FINPROOF_AUTH_JWT_AUDIENCE"
  );
  requireWhen(missing, reviewStore === "prisma", env, "DATABASE_URL");
  requireWhen(missing, analysisExecutionMode === "queued", env, "FINPROOF_WORKER_TENANT_ID");
  requireWhen(missing, modelProvider === "openai", env, "OPENAI_API_KEY");
  requireWhen(missing, modelProvider === "gemini", env, "GEMINI_API_KEY");
  requireWhen(missing, modelProvider === "router", env, "OPENAI_API_KEY");
  requireWhen(missing, modelProvider === "router", env, "GEMINI_API_KEY");
  requireWhen(missing, ocrProvider === "http", env, "FINPROOF_OCR_ENDPOINT");
  requireWhen(missing, ragProvider === "postgres", env, "DATABASE_URL");
  requireWhen(missing, rerankProvider === "http", env, "FINPROOF_RERANK_ENDPOINT");
  requireWhen(missing, uploadScanProvider === "http", env, "FINPROOF_UPLOAD_SCAN_ENDPOINT");
  requireWhen(missing, storageProvider === "s3", env, "FINPROOF_S3_BUCKET");
  requireWhen(missing, storageProvider === "s3", env, "AWS_REGION");

  requireProductionProvider(productionGaps, authMode !== "jwt", "FINPROOF_AUTH_MODE=jwt");
  requireProductionProvider(
    productionGaps,
    reviewStore !== "prisma",
    "FINPROOF_REVIEW_STORE=prisma"
  );
  requireProductionProvider(
    productionGaps,
    modelProvider === "deterministic",
    "FINPROOF_MODEL_PROVIDER=router|openai|gemini"
  );
  requireProductionProvider(productionGaps, ocrProvider !== "http", "FINPROOF_OCR_PROVIDER=http");
  requireProductionProvider(
    productionGaps,
    ragProvider !== "postgres",
    "FINPROOF_RAG_PROVIDER=postgres"
  );
  requireProductionProvider(
    productionGaps,
    rerankProvider !== "http",
    "FINPROOF_RERANK_PROVIDER=http"
  );
  requireProductionProvider(
    productionGaps,
    uploadScanProvider !== "http",
    "FINPROOF_UPLOAD_SCAN_PROVIDER=http"
  );
  requireProductionProvider(
    productionGaps,
    storageProvider !== "s3",
    "FINPROOF_STORAGE_ADAPTER=s3"
  );
  requireProductionProvider(
    productionGaps,
    value(env, "FINPROOF_ENABLE_SAMPLE_DATA") === "true",
    "FINPROOF_ENABLE_SAMPLE_DATA=false"
  );

  return {
    auth: {
      mode: authMode,
      provider: authProvider,
      configured:
        authMode === "demo" ||
        authProvider === "hs256" ||
        (authProvider === "jwks" &&
          Boolean(value(env, "FINPROOF_AUTH_JWT_ISSUER")) &&
          Boolean(value(env, "FINPROOF_AUTH_JWT_AUDIENCE")))
    },
    reviewStore: {
      provider: reviewStore,
      configured: reviewStore === "mock" || Boolean(value(env, "DATABASE_URL"))
    },
    analysis: {
      executionMode: analysisExecutionMode,
      configured:
        analysisExecutionMode === "inline" || Boolean(value(env, "FINPROOF_WORKER_TENANT_ID"))
    },
    model: {
      provider: modelProvider,
      model:
        modelProvider === "gemini"
          ? (value(env, "GEMINI_MODEL") ?? "gemini-2.5-flash")
          : modelProvider === "openai"
            ? (value(env, "OPENAI_MODEL") ?? "gpt-5-mini")
            : undefined,
      ...(modelProvider === "router" ? getModelRoutingConfig(env) : {}),
      configured:
        modelProvider === "deterministic" ||
        (modelProvider === "openai" && secretState(env, "OPENAI_API_KEY") === "set") ||
        (modelProvider === "gemini" && secretState(env, "GEMINI_API_KEY") === "set") ||
        (modelProvider === "router" &&
          secretState(env, "OPENAI_API_KEY") === "set" &&
          secretState(env, "GEMINI_API_KEY") === "set")
    },
    ocr: {
      provider: ocrProvider,
      configured: ocrProvider === "deterministic" || Boolean(value(env, "FINPROOF_OCR_ENDPOINT"))
    },
    rag: {
      provider: ragProvider,
      configured: ragProvider === "deterministic" || Boolean(value(env, "DATABASE_URL")),
      topK: numberValue(env, "FINPROOF_RAG_TOP_K", 4),
      minScore: numberValue(env, "FINPROOF_RAG_MIN_SCORE", 0.72),
      maxContextChars: numberValue(env, "FINPROOF_RAG_MAX_CONTEXT_CHARS", 6000)
    },
    rerank: {
      provider: rerankProvider,
      configured:
        rerankProvider === "deterministic" || Boolean(value(env, "FINPROOF_RERANK_ENDPOINT")),
      model: rerankProvider === "deterministic" ? "deterministic-reranker" : rerankModel
    },
    uploadScan: {
      provider: uploadScanProvider,
      configured:
        uploadScanProvider === "deterministic" ||
        Boolean(value(env, "FINPROOF_UPLOAD_SCAN_ENDPOINT"))
    },
    storage: {
      provider: storageProvider,
      bucket: value(env, "FINPROOF_S3_BUCKET"),
      region: value(env, "AWS_REGION"),
      configured:
        storageProvider === "local-metadata" ||
        (Boolean(value(env, "FINPROOF_S3_BUCKET")) && Boolean(value(env, "AWS_REGION")))
    },
    secrets: {
      DATABASE_URL: secretState(env, "DATABASE_URL"),
      DIRECT_URL: secretState(env, "DIRECT_URL"),
      FINPROOF_AUTH_JWT_SECRET: secretState(env, "FINPROOF_AUTH_JWT_SECRET"),
      FINPROOF_AUTH_JWKS_URL: secretState(env, "FINPROOF_AUTH_JWKS_URL"),
      OPENAI_API_KEY: secretState(env, "OPENAI_API_KEY"),
      GEMINI_API_KEY: secretState(env, "GEMINI_API_KEY"),
      FINPROOF_OCR_API_KEY: secretState(env, "FINPROOF_OCR_API_KEY"),
      FINPROOF_RERANK_API_KEY: secretState(env, "FINPROOF_RERANK_API_KEY"),
      FINPROOF_UPLOAD_SCAN_API_KEY: secretState(env, "FINPROOF_UPLOAD_SCAN_API_KEY"),
      AWS_ACCESS_KEY_ID: secretState(env, "AWS_ACCESS_KEY_ID"),
      AWS_SECRET_ACCESS_KEY: secretState(env, "AWS_SECRET_ACCESS_KEY")
    },
    missing,
    productionGaps,
    productionReady: missing.length === 0 && productionGaps.length === 0
  };
}

export function redactedBackendRuntimeConfig(config: BackendRuntimeConfig): BackendRuntimeConfig {
  const setSecrets = Object.fromEntries(
    Object.entries(config.secrets).filter(([, state]) => state === "set")
  );

  return {
    ...config,
    secrets: setSecrets
  };
}

export function assertBackendProductionReady(config = getBackendRuntimeConfig()) {
  if (!config.productionReady) {
    const blockers = [...config.missing, ...config.productionGaps].join(", ");

    throw new Error(`Backend production readiness failed: ${blockers}`);
  }

  return config;
}
