import { providerForModel } from "@/server/ai/model-router";

type Env = Record<string, string | undefined>;

type OcrConfig =
  | { provider: "deterministic" }
  | { provider: "http"; endpoint: string | undefined; apiKeyConfigured: boolean }
  | { provider: "gemini"; apiKeyConfigured: boolean; model: string }
  | { provider: "openai"; apiKeyConfigured: boolean; model: string };

type RagConfig =
  | {
      provider: "deterministic";
      topK: number;
      minScore: number;
      knowledgeMinScore: number;
      maxContextChars: number;
    }
  | {
      provider: "postgres";
      databaseConfigured: boolean;
      topK: number;
      minScore: number;
      knowledgeMinScore: number;
      maxContextChars: number;
    };

type RerankConfig =
  | {
      provider: "deterministic";
      model: string;
      topK: number;
    }
  | {
      provider: "http";
      endpoint: string | undefined;
      apiKeyConfigured: boolean;
      model: string;
      topK: number;
    }
  | {
      provider: "cohere";
      apiKeyConfigured: boolean;
      model: string;
      topK: number;
    };

export type AnalysisProviderConfig = {
  ocr: OcrConfig;
  rag: RagConfig;
  rerank: RerankConfig;
  missing: string[];
};

function value(env: Env, key: string): string | undefined {
  const raw = env[key];

  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function positiveNumber(env: Env, key: string, fallback: number) {
  const raw = value(env, key);
  const parsed = raw ? Number(raw) : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAnalysisProviderConfig(env: Env = process.env): AnalysisProviderConfig {
  const missing: string[] = [];
  const ocrProviderValue = value(env, "FINPROOF_OCR_PROVIDER");
  const ocrProvider =
    ocrProviderValue === "http" || ocrProviderValue === "gemini" || ocrProviderValue === "openai"
      ? ocrProviderValue
      : "deterministic";
  const ragProvider =
    value(env, "FINPROOF_RAG_PROVIDER") === "postgres" ? "postgres" : "deterministic";
  const topK = positiveNumber(env, "FINPROOF_RAG_TOP_K", 4);
  const minScore = positiveNumber(env, "FINPROOF_RAG_MIN_SCORE", 0.5);
  // Knowledge-corpus retrieval uses a lower cosine floor than product docs: Korean
  // ad-copy↔regulation cosine tops out ~0.6, so an on-point checklist can sit at ~0.46
  // and would be dropped by the product-doc `minScore` before reranking ever sees it.
  const knowledgeMinScore = positiveNumber(env, "FINPROOF_RAG_KNOWLEDGE_MIN_SCORE", 0.4);
  const maxContextChars = positiveNumber(env, "FINPROOF_RAG_MAX_CONTEXT_CHARS", 6000);
  const rerankProviderValue = value(env, "FINPROOF_RERANK_PROVIDER");
  const rerankProvider =
    rerankProviderValue === "http" || rerankProviderValue === "cohere"
      ? rerankProviderValue
      : "deterministic";
  const rerankModel =
    value(env, "FINPROOF_RERANK_MODEL") ??
    (rerankProvider === "cohere" ? "rerank-v4.0-pro" : "bge-reranker-v2-m3");
  const rerankTopK = positiveNumber(env, "FINPROOF_RERANK_TOP_K", topK);
  const endpoint = value(env, "FINPROOF_OCR_ENDPOINT");
  const ocrModel =
    value(env, "FINPROOF_OCR_MODEL") ??
    (ocrProvider === "openai" ? "claude-opus-4-8" : "gemini-2.5-flash-lite");
  const ocrVisionApiKey =
    providerForModel(ocrModel) === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const rerankEndpoint = value(env, "FINPROOF_RERANK_ENDPOINT");
  const databaseUrl = value(env, "DATABASE_URL");

  if (ocrProvider === "http" && !endpoint) {
    missing.push("FINPROOF_OCR_ENDPOINT");
  }
  if (ocrProvider === "gemini" && !value(env, "GEMINI_API_KEY")) {
    missing.push("GEMINI_API_KEY");
  }
  if (ocrProvider === "openai" && !value(env, ocrVisionApiKey)) {
    missing.push(ocrVisionApiKey);
  }

  if (ragProvider === "postgres" && !databaseUrl) {
    missing.push("DATABASE_URL");
  }

  if (rerankProvider === "http" && !rerankEndpoint) {
    missing.push("FINPROOF_RERANK_ENDPOINT");
  }
  if (rerankProvider === "cohere" && !value(env, "COHERE_API_KEY")) {
    missing.push("COHERE_API_KEY");
  }

  return {
    ocr:
      ocrProvider === "http"
        ? {
            provider: "http",
            endpoint,
            apiKeyConfigured: Boolean(value(env, "FINPROOF_OCR_API_KEY"))
          }
        : ocrProvider === "gemini"
          ? {
              provider: "gemini",
              apiKeyConfigured: Boolean(value(env, "GEMINI_API_KEY")),
              model: ocrModel
            }
          : ocrProvider === "openai"
            ? {
                provider: "openai",
                apiKeyConfigured: Boolean(value(env, ocrVisionApiKey)),
                model: ocrModel
              }
            : { provider: "deterministic" },
    rag:
      ragProvider === "postgres"
        ? {
            provider: "postgres",
            databaseConfigured: Boolean(databaseUrl),
            topK,
            minScore,
            knowledgeMinScore,
            maxContextChars
          }
        : {
            provider: "deterministic",
            topK,
            minScore,
            knowledgeMinScore,
            maxContextChars
          },
    rerank:
      rerankProvider === "http"
        ? {
            provider: "http",
            endpoint: rerankEndpoint,
            apiKeyConfigured: Boolean(value(env, "FINPROOF_RERANK_API_KEY")),
            model: rerankModel,
            topK: rerankTopK
          }
        : rerankProvider === "cohere"
          ? {
              provider: "cohere",
              apiKeyConfigured: Boolean(value(env, "COHERE_API_KEY")),
              model: rerankModel,
              topK: rerankTopK
            }
          : {
              provider: "deterministic",
              model: "deterministic-reranker",
              topK: rerankTopK
            },
    missing
  };
}
