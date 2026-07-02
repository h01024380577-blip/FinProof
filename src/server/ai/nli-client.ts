export type NliScores = {
  entailment: number;
  neutral: number;
  contradiction: number;
};

export type NliClient = {
  classify(input: { premise: string; hypothesis: string }): Promise<NliScores>;
};

function toScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function createHttpNliClient(config: {
  baseUrl: string;
  timeoutMs?: number;
}): NliClient {
  const timeoutMs = config.timeoutMs ?? 4000;

  async function attempt(input: { premise: string; hypothesis: string }): Promise<NliScores> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}/nli`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ premise: input.premise, hypothesis: input.hypothesis }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`NLI service responded with ${response.status}`);
      }

      const data = (await response.json()) as { scores?: Record<string, unknown> };
      const scores = data.scores ?? {};

      return {
        entailment: toScore(scores.entailment),
        neutral: toScore(scores.neutral),
        contradiction: toScore(scores.contradiction)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async classify(input) {
      try {
        return await attempt(input);
      } catch {
        return await attempt(input);
      }
    }
  };
}
