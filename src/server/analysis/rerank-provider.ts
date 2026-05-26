import type { RagEvidenceCandidate } from "./review-analysis-pipeline";
import { getAnalysisProviderConfig } from "./provider-config";

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

export type RerankInput = {
  query: string;
  candidates: RagEvidenceCandidate[];
};

export type Reranker = {
  provider: string;
  rerank(input: RerankInput): Promise<RagEvidenceCandidate[]>;
};

function value(env: Env, key: string): string | undefined {
  const raw = env[key];

  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function overlapScore(query: string, text: string): number {
  const terms = query
    .split(/[\s.,:;!?()[\]{}"'`~|\\/]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  if (terms.length === 0) {
    return 0;
  }

  const target = text.toLowerCase();
  const matches = terms.filter((term) => target.includes(term.toLowerCase())).length;

  return matches / terms.length;
}

export function createDeterministicReranker(): Reranker {
  return {
    provider: "deterministic-reranker",
    async rerank({ query, candidates }) {
      return [...candidates].sort((left, right) => {
        const leftScore = left.relevanceScore + overlapScore(query, left.quoteSummary) / 10;
        const rightScore = right.relevanceScore + overlapScore(query, right.quoteSummary) / 10;

        return rightScore - leftScore;
      });
    }
  };
}

function parseRerankResponse(
  body: unknown,
  candidates: RagEvidenceCandidate[]
): RagEvidenceCandidate[] {
  if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results)) {
    return candidates;
  }

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const ranked = body.results
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const id = "id" in item && typeof item.id === "string" ? item.id : undefined;
      const index = "index" in item && typeof item.index === "number" ? item.index : undefined;
      const score = "score" in item && typeof item.score === "number" ? item.score : undefined;
      const candidate = id ? byId.get(id) : index !== undefined ? candidates[index] : undefined;

      return candidate ? [{ ...candidate, relevanceScore: score ?? candidate.relevanceScore }] : [];
    })
    .filter((candidate) => byId.has(candidate.id));
  const rankedIds = new Set(ranked.map((candidate) => candidate.id));

  return [...ranked, ...candidates.filter((candidate) => !rankedIds.has(candidate.id))];
}

export function createHttpReranker(env: Env = process.env, fetchImpl: FetchLike = fetch): Reranker {
  const config = getAnalysisProviderConfig(env).rerank;

  if (config.provider !== "http" || !config.endpoint) {
    throw new Error("FINPROOF_RERANK_ENDPOINT is required when FINPROOF_RERANK_PROVIDER=http");
  }

  const endpoint = config.endpoint;

  return {
    provider: config.model,
    async rerank({ query, candidates }) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(value(env, "FINPROOF_RERANK_API_KEY")
            ? { authorization: `Bearer ${value(env, "FINPROOF_RERANK_API_KEY")}` }
            : {})
        },
        body: JSON.stringify({
          model: config.model,
          query,
          documents: candidates.map((candidate) => ({
            id: candidate.id,
            text: candidate.quoteSummary,
            title: candidate.title,
            sourceType: candidate.sourceType
          }))
        })
      });

      if (!response.ok) {
        throw new Error(
          `Rerank provider failed: ${response.status ?? "unknown"} ${response.statusText ?? ""}`.trim()
        );
      }

      return parseRerankResponse(await response.json(), candidates);
    }
  };
}

export function createReranker(env: Env = process.env): Reranker {
  return getAnalysisProviderConfig(env).rerank.provider === "http"
    ? createHttpReranker(env)
    : createDeterministicReranker();
}
