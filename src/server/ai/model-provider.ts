import {
  getModelRoutingConfig,
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
  provider: "deterministic" | "openai" | "gemini";
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
  const provider =
    providerValue === "openai" || providerValue === "gemini" || providerValue === "router"
      ? providerValue
      : "deterministic";
  const model =
    provider === "gemini"
      ? (envValue(env, "GEMINI_MODEL") ?? "gemini-2.5-flash")
      : (envValue(env, "OPENAI_MODEL") ?? "gpt-5-mini");

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
          route.model
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

  return createProviderForRoute(env, fetchImpl, provider, model);
}

function createProviderForRoute(
  env: Env,
  fetchImpl: FetchLike,
  provider: "openai" | "gemini",
  model: string
): ModelProvider {
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
