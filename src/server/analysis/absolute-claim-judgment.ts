import type { ReviewCase } from "@/domain/types";
import { ABSOLUTE_CLAIM_JUDGMENT_PROMPT } from "@/server/ai/prompt-registry";
import type { ModelProvider } from "@/server/ai/model-provider";
import {
  detectAbsoluteClaimCandidates,
  type AbsoluteClaimCandidate,
  type AbsoluteClaimDecision
} from "./issue-generation";

type ExtractedDocumentLike = {
  fileId: string;
  fileName: string;
  text: string;
  confidence: number;
  provider: string;
};

export type AbsoluteClaimVerdict = {
  candidateId: string;
  term: string;
  sentence: string;
  misleading: boolean;
  reason: string;
  judgedBy: "llm" | "fallback";
};

/**
 * Full audit trail for the procedural absolute-claim judgment: every candidate
 * span, its per-span verdict, and the aggregated decision the reducer consumes.
 */
export type AbsoluteClaimJudgment = {
  candidates: AbsoluteClaimCandidate[];
  verdicts: AbsoluteClaimVerdict[];
  /**
   * Aggregated decision for buildAnalysisIssues:
   * - object → misleading, create the issue;
   * - null → judged and benign, no issue;
   * - undefined → no model judgment available, defer to the lexical fallback.
   */
  decision: AbsoluteClaimDecision | null | undefined;
};

function combinedText(documents: ExtractedDocumentLike[]): string {
  return documents
    .map((document) => document.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    : trimmed;
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function verdictsFromModel(
  text: string,
  candidatesById: Map<string, AbsoluteClaimCandidate>
): Map<string, { misleading: boolean; reason: string }> {
  const parsed = extractJsonObject(text);
  const results = new Map<string, { misleading: boolean; reason: string }>();
  if (!parsed || typeof parsed !== "object" || !("verdicts" in parsed)) {
    return results;
  }
  const rawVerdicts = Array.isArray((parsed as { verdicts: unknown }).verdicts)
    ? (parsed as { verdicts: unknown[] }).verdicts
    : [];
  for (const raw of rawVerdicts) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const fields = raw as Record<string, unknown>;
    const candidateId = typeof fields.candidateId === "string" ? fields.candidateId : "";
    if (!candidatesById.has(candidateId) || typeof fields.misleading !== "boolean") {
      continue;
    }
    results.set(candidateId, {
      misleading: fields.misleading,
      reason:
        typeof fields.reason === "string" && fields.reason.trim()
          ? fields.reason.trim()
          : "문맥 판단 근거가 제공되지 않았습니다."
    });
  }
  return results;
}

function aggregateDecision(
  verdicts: AbsoluteClaimVerdict[],
  judgedBy: "llm" | "fallback"
): AbsoluteClaimDecision | null {
  const misleading = verdicts.find((verdict) => verdict.misleading);
  if (!misleading) {
    return null;
  }
  return {
    misleading: true,
    targetText: misleading.term,
    reason: misleading.reason,
    judgedBy
  };
}

/**
 * Procedurally judge whether the absolute expressions in the ad actually mislead
 * the consumer, replacing the previous purely-lexical rule. Detection stays
 * high-recall regex; the keep/drop call is delegated to the model in context.
 * Returns a null decision (no issue) when every candidate is judged benign.
 */
export async function judgeAbsoluteClaims(input: {
  review: ReviewCase;
  extractedDocuments: ExtractedDocumentLike[];
  modelProvider: ModelProvider;
}): Promise<AbsoluteClaimJudgment> {
  const { review, extractedDocuments, modelProvider } = input;
  const text = combinedText(extractedDocuments);
  const candidates = detectAbsoluteClaimCandidates(text);

  if (candidates.length === 0) {
    return { candidates, verdicts: [], decision: null };
  }

  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  let modelVerdicts = new Map<string, { misleading: boolean; reason: string }>();
  try {
    const result = await modelProvider.generateText({
      task: "absolute_claim_judgment",
      routeContext: { riskLevel: "high" },
      instructions: ABSOLUTE_CLAIM_JUDGMENT_PROMPT,
      input: JSON.stringify({
        review: {
          id: review.id,
          title: review.title,
          productType: review.productType,
          channelType: review.channelType
        },
        candidates: candidates.map((candidate) => ({
          candidateId: candidate.id,
          term: candidate.term,
          sentence: candidate.sentence
        })),
        outputSchema: {
          verdicts: "array of { candidateId, misleading: boolean, reason }"
        }
      }),
      fallback: '{"verdicts":[]}'
    });
    modelVerdicts = verdictsFromModel(result.text, candidatesById);
  } catch {
    modelVerdicts = new Map();
  }

  const anyLlmVerdict = modelVerdicts.size > 0;
  const verdicts: AbsoluteClaimVerdict[] = candidates.map((candidate) => {
    const modelVerdict = modelVerdicts.get(candidate.id);
    if (modelVerdict) {
      return {
        candidateId: candidate.id,
        term: candidate.term,
        sentence: candidate.sentence,
        misleading: modelVerdict.misleading,
        reason: modelVerdict.reason,
        judgedBy: "llm"
      };
    }
    // Candidate the model did not return a verdict for: default to benign when
    // the LLM answered at all (it deliberately dropped it), otherwise leave the
    // aggregate to the lexical fallback below.
    return {
      candidateId: candidate.id,
      term: candidate.term,
      sentence: candidate.sentence,
      misleading: false,
      reason: anyLlmVerdict
        ? "모델이 오인 표현으로 지목하지 않았습니다."
        : "모델 판단을 사용할 수 없어 보류되었습니다.",
      judgedBy: "fallback"
    };
  });

  if (anyLlmVerdict) {
    return { candidates, verdicts, decision: aggregateDecision(verdicts, "llm") };
  }

  // No model judgment available — leave the decision undefined so
  // buildAnalysisIssues re-derives it from the lexical fallback.
  return { candidates, verdicts, decision: undefined };
}
