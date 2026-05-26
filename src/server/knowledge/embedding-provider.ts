type Env = Record<string, string | undefined>;

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
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
          "content-type": "application/json",
          ...(value(env, "FINPROOF_EMBEDDING_API_KEY")
            ? { authorization: `Bearer ${value(env, "FINPROOF_EMBEDDING_API_KEY")}` }
            : {})
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

export function createEmbeddingProvider(env: Env = process.env): EmbeddingProvider {
  return value(env, "FINPROOF_EMBEDDING_PROVIDER") === "http"
    ? createHttpEmbeddingProvider(env)
    : createDeterministicEmbeddingProvider();
}
