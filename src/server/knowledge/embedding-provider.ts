type Env = Record<string, string | undefined>;

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}>;

export type EmbeddingProvider = {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
};

function value(env: Env, key: string): string | undefined {
  const raw = env[key];

  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function hashText(text: string, salt: number): number {
  let hash = 2166136261 + salt;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function createDeterministicEmbeddingProvider(): EmbeddingProvider {
  return {
    model: "deterministic-embedding",
    async embed(texts) {
      return texts.map((text) => {
        const vector = Array.from({ length: 64 }, (_, index) => {
          const hashed = hashText(text, index + 1);

          return (hashed % 2000) / 1000 - 1;
        });
        const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;

        return vector.map((item) => Number((item / magnitude).toFixed(8)));
      });
    }
  };
}

function parseEmbeddingResponse(body: unknown): number[][] {
  if (!body || typeof body !== "object") {
    return [];
  }

  if ("embeddings" in body && Array.isArray(body.embeddings)) {
    return body.embeddings.filter(
      (item): item is number[] =>
        Array.isArray(item) && item.every((value) => typeof value === "number")
    );
  }

  if ("data" in body && Array.isArray(body.data)) {
    return body.data
      .map((item) =>
        item && typeof item === "object" && "embedding" in item && Array.isArray(item.embedding)
          ? item.embedding
          : undefined
      )
      .filter(
        (item): item is number[] =>
          Array.isArray(item) && item.every((value) => typeof value === "number")
      );
  }

  return [];
}

type EmbeddingResponse = Awaited<ReturnType<FetchLike>>;

const MAX_EMBEDDING_ATTEMPTS = 3;

// OpenAI rejects requests over 300,000 tokens; keep a safety margin and stay
// under the 2,048-input array cap. Korean text is token-dense, so estimate
// conservatively (~0.9 tokens/char) when packing chunks into a request.
const MAX_TOKENS_PER_REQUEST = 250_000;
const MAX_INPUTS_PER_REQUEST = 2048;

function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.9);
}

/** Split chunk texts into request-sized batches that stay under the API caps. */
function batchByTokenBudget(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);
    const wouldExceed =
      current.length > 0 &&
      (currentTokens + tokens > MAX_TOKENS_PER_REQUEST ||
        current.length >= MAX_INPUTS_PER_REQUEST);

    if (wouldExceed) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(text);
    currentTokens += tokens;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientStatus(status?: number): boolean {
  return status === 408 || status === 429 || (typeof status === "number" && status >= 500);
}

async function readErrorDetail(response: EmbeddingResponse): Promise<string> {
  try {
    const body = (await response.text?.()) ?? "";
    const trimmed = body.trim();

    if (!trimmed) {
      return "";
    }

    // Surface OpenAI's structured { error: { message } } when present.
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
      if (parsed.error?.message) {
        return parsed.error.message;
      }
    } catch {
      // Non-JSON body; fall through to the raw text.
    }

    return trimmed.slice(0, 300);
  } catch {
    return "";
  }
}

function hintForStatus(status?: number): string {
  if (status === 401 || status === 403) {
    return " (OPENAI_API_KEY가 거부되었습니다. 키 값·만료·프로젝트 권한을 확인하고, 서버를 재시작해 최신 키를 적용하세요.)";
  }

  return "";
}

export function createHttpEmbeddingProvider(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch
): EmbeddingProvider {
  const endpoint = value(env, "FINPROOF_EMBEDDING_ENDPOINT");
  const model = value(env, "FINPROOF_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  if (!endpoint) {
    throw new Error("FINPROOF_EMBEDDING_ENDPOINT is required when embeddings use HTTP");
  }

  return {
    model,
    async embed(texts) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: texts
        })
      });

      if (!response.ok) {
        throw new Error(
          `Embedding provider failed: ${response.status ?? "unknown"} ${
            response.statusText ?? ""
          }`.trim()
        );
      }

      const embeddings = parseEmbeddingResponse(await response.json());

      if (embeddings.length !== texts.length) {
        throw new Error("Embedding provider returned an unexpected embedding count");
      }

      return embeddings;
    }
  };
}

export function createOpenAiEmbeddingProvider(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch
): EmbeddingProvider {
  const endpoint =
    value(env, "FINPROOF_EMBEDDING_ENDPOINT") ?? "https://api.openai.com/v1/embeddings";
  const apiKey = value(env, "OPENAI_API_KEY");
  const model = value(env, "FINPROOF_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when embeddings use OpenAI");
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_EMBEDDING_ATTEMPTS; attempt += 1) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: texts
        })
      });

      if (response.ok) {
        const embeddings = parseEmbeddingResponse(await response.json());

        if (embeddings.length !== texts.length) {
          throw new Error("OpenAI embedding provider returned an unexpected embedding count");
        }

        return embeddings;
      }

      const detail = await readErrorDetail(response);
      const baseMessage = `OpenAI embedding provider failed: ${
        response.status ?? "unknown"
      } ${response.statusText ?? ""}`.trim();
      lastError = new Error(
        `${baseMessage}${detail ? ` - ${detail}` : ""}${hintForStatus(response.status)}`
      );

      // Only transient errors are worth retrying; auth/4xx errors will not self-resolve.
      if (!isTransientStatus(response.status) || attempt === MAX_EMBEDDING_ATTEMPTS) {
        throw lastError;
      }

      await sleep(250 * attempt);
    }

    throw lastError ?? new Error("OpenAI embedding provider failed");
  }

  return {
    model,
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }

      // Large documents produce more chunks than fit in one request; embed in
      // token-budgeted batches and preserve input order in the result.
      const batches = batchByTokenBudget(texts);
      const embeddings: number[][] = [];

      for (const batch of batches) {
        embeddings.push(...(await embedBatch(batch)));
      }

      return embeddings;
    }
  };
}

export function createEmbeddingProvider(env: Env = process.env): EmbeddingProvider {
  const provider = value(env, "FINPROOF_EMBEDDING_PROVIDER");

  if (provider === "http") {
    return createHttpEmbeddingProvider(env);
  }

  if (provider === "openai") {
    return createOpenAiEmbeddingProvider(env);
  }

  if (provider === "deterministic") {
    return createDeterministicEmbeddingProvider();
  }

  return value(env, "OPENAI_API_KEY")
    ? createOpenAiEmbeddingProvider(env)
    : createDeterministicEmbeddingProvider();
}
