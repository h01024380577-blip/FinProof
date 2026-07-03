import {
  getModelRoutingConfig,
  providerForModel,
  selectModelRoute,
  type ModelRouteContext,
  type ModelRouteTask,
  type ModelTier
} from "./model-router";

type Env = Record<string, string | undefined>;

type GenerateTextInput = {
  task: string | ModelRouteTask;
  routeContext?: ModelRouteContext;
  instructions: string;
  input: string;
  fallback: string;
};

type GenerateTextResult = {
  provider: "deterministic" | "anthropic" | "openai" | "gemini";
  model: string;
  text: string;
  modelTier?: ModelTier;
  escalationReason?: string;
};

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

export type ModelProvider = {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
};

function envValue(env: Env, key: string): string | undefined {
  const value = env[key];

  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveNumber(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Anthropic's Messages API requires max_tokens, so it cannot be omitted. Default
 * it to each model's synchronous maximum output so answers/drafts are never
 * artificially truncated; FINPROOF_MODEL_MAX_TOKENS still overrides. Unknown
 * models get a conservative floor (undershooting only truncates, whereas
 * exceeding a model's real cap would be a hard API error).
 */
function maxOutputTokensFor(model: string): number {
  const normalized = model.trim().toLowerCase();

  if (normalized.startsWith("claude-opus")) {
    return 128_000;
  }

  if (normalized.startsWith("claude-sonnet")) {
    return 64_000;
  }

  return 8192;
}

export function extractOpenAIText(body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "output_text" in body &&
    typeof body.output_text === "string"
  ) {
    return body.output_text;
  }

  if (!body || typeof body !== "object" || !("output" in body) || !Array.isArray(body.output)) {
    return "";
  }

  for (const output of body.output) {
    if (!output || typeof output !== "object" || !("content" in output)) {
      continue;
    }

    const content = output.content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "output_text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
    }
  }

  return "";
}

export function extractAnthropicText(body: unknown): string {
  if (
    !body ||
    typeof body !== "object" ||
    !("content" in body) ||
    !Array.isArray(body.content)
  ) {
    return "";
  }

  for (const part of body.content) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      return part.text;
    }
  }

  return "";
}

export function extractGeminiText(body: unknown): string {
  if (
    !body ||
    typeof body !== "object" ||
    !("candidates" in body) ||
    !Array.isArray(body.candidates)
  ) {
    return "";
  }

  for (const candidate of body.candidates) {
    if (!candidate || typeof candidate !== "object" || !("content" in candidate)) {
      continue;
    }

    const { content } = candidate;

    if (!content || typeof content !== "object" || !("parts" in content)) {
      continue;
    }

    const { parts } = content;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
    }
  }

  return "";
}

export function createModelProvider(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch
): ModelProvider {
  const providerValue = envValue(env, "FINPROOF_MODEL_PROVIDER");
  if (providerValue === "gemini") {
    return {
      async generateText() {
        throw new Error("FINPROOF_MODEL_PROVIDER=gemini is disabled; Gemini is only allowed for OCR");
      }
    };
  }

  const provider =
    providerValue === "anthropic" || providerValue === "openai" || providerValue === "router"
      ? providerValue
      : "deterministic";
  const model =
    envValue(env, "ANTHROPIC_MODEL") ??
    envValue(env, "OPENAI_MODEL") ??
    (providerValue === "openai" ? "gpt-5-mini" : "claude-sonnet-4-6");

  if (provider === "deterministic") {
    return {
      async generateText(input) {
        return {
          provider: "deterministic",
          model: "deterministic",
          text: input.fallback
        };
      }
    };
  }

  const modelTimeoutMs = positiveNumber(env, "FINPROOF_MODEL_TIMEOUT_MS", 300_000);

  if (provider === "router") {
    return {
      async generateText(input) {
        const route = selectModelRoute(
          input.task as ModelRouteTask,
          input.routeContext ?? {},
          getModelRoutingConfig(env)
        );
        const providerForRoute = createProviderForRoute(
          env,
          fetchImpl,
          route.provider,
          route.model,
          modelTimeoutMs
        );
        const result = await providerForRoute.generateText(input);

        return {
          ...result,
          modelTier: route.modelTier,
          escalationReason: route.escalationReason
        };
      }
    };
  }

  return createProviderForRoute(env, fetchImpl, providerForModel(model), model, modelTimeoutMs);
}

function createProviderForRoute(
  env: Env,
  fetchImpl: FetchLike,
  provider: "anthropic" | "openai" | "gemini",
  model: string,
  modelTimeoutMs: number
): ModelProvider {
  if (provider === "anthropic") {
    return {
      async generateText(input) {
        const apiKey = envValue(env, "ANTHROPIC_API_KEY");

        if (!apiKey) {
          throw new Error("ANTHROPIC_API_KEY is required when routing to a Claude model");
        }

        const maxTokens = positiveNumber(env, "FINPROOF_MODEL_MAX_TOKENS", maxOutputTokensFor(model));
        const anthropicVersion = envValue(env, "ANTHROPIC_VERSION") ?? "2023-06-01";

        const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: AbortSignal.timeout(modelTimeoutMs),
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": anthropicVersion,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system: input.instructions,
            messages: [{ role: "user", content: input.input }]
          })
        });

        if (!response.ok) {
          throw new Error(
            `Anthropic Messages API request failed: ${response.status ?? "unknown"} ${
              response.statusText ?? ""
            }`.trim()
          );
        }

        const text = extractAnthropicText(await response.json()).trim();

        return {
          provider,
          model,
          text: text || input.fallback
        };
      }
    };
  }

  if (provider === "gemini") {
    return {
      async generateText(input) {
        const apiKey = envValue(env, "GEMINI_API_KEY");

        if (!apiKey) {
          throw new Error("GEMINI_API_KEY is required when FINPROOF_MODEL_PROVIDER=gemini");
        }

        const response = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            signal: AbortSignal.timeout(modelTimeoutMs),
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: input.instructions }]
              },
              contents: [{ parts: [{ text: input.input }] }]
            })
          }
        );

        if (!response.ok) {
          throw new Error(
            `Gemini generateContent request failed: ${response.status ?? "unknown"} ${
              response.statusText ?? ""
            }`.trim()
          );
        }

        const text = extractGeminiText(await response.json()).trim();

        return {
          provider,
          model,
          text: text || input.fallback
        };
      }
    };
  }

  return {
    async generateText(input) {
      const apiKey = envValue(env, "OPENAI_API_KEY");

      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is required when FINPROOF_MODEL_PROVIDER=openai");
      }

      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: AbortSignal.timeout(modelTimeoutMs),
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          instructions: input.instructions,
          input: input.input
        })
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI Responses API request failed: ${response.status ?? "unknown"} ${
            response.statusText ?? ""
          }`.trim()
        );
      }

      const text = extractOpenAIText(await response.json()).trim();

      return {
        provider,
        model,
        text: text || input.fallback
      };
    }
  };
}
