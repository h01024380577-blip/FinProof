import type { NliClient, NliScores } from "@/server/ai/nli-client";
import type {
  LocalizedRiskFinding,
  SemanticPreservation,
  SemanticRelation
} from "./multilingual";

const DEFAULT_MODEL = "mDeBERTa-v3-base-mnli-xnli";

const OVERCLAIM_TERMS = [
  "guaranteed",
  "guarantee",
  "for everyone",
  "everyone",
  "no hidden fees",
  "no fees",
  "instant",
  "lowest",
  "always",
  "보장",
  "누구나",
  "무조건",
  "전원",
  "무료",
  "즉시",
  "최저"
];

const CONDITION_TERMS = [
  "credit review",
  "screening",
  "may vary",
  "subject to",
  "depending",
  "eligibility",
  "심사",
  "신용심사",
  "변동",
  "달라질",
  "조건",
  "자격",
  "기준"
];

function matchedTerms(haystack: string, terms: string[], guardNegation = false): string[] {
  const lower = haystack.toLowerCase();
  return terms.filter((term) => {
    const needle = term.toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx === -1) {
      return false;
    }
    if (!guardNegation) {
      return true;
    }
    const prefix = lower.slice(Math.max(0, idx - 7), idx);
    return !/\b(no|not|never|cannot)\s+$/.test(prefix);
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function deriveSemanticRelation(input: {
  scores: NliScores;
  premise: string;
  hypothesis: string;
}): {
  relation: SemanticRelation;
  missingConditionTerms: string[];
  overclaimTerms: string[];
} {
  const overclaimInHypothesis = matchedTerms(input.hypothesis, OVERCLAIM_TERMS, true);
  const overclaimInPremise = matchedTerms(input.premise, OVERCLAIM_TERMS, true);
  const overclaimTerms = overclaimInHypothesis.filter(
    (term) => !overclaimInPremise.includes(term)
  );

  // Cross-lingual: the premise is Korean and the hypothesis is a foreign
  // language, so a per-term intersection never overlaps. Instead treat it as
  // missing-condition only when the source states conditions and the foreign
  // copy states none in its own language.
  const conditionsInPremise = matchedTerms(input.premise, CONDITION_TERMS);
  const conditionsInHypothesis = matchedTerms(input.hypothesis, CONDITION_TERMS);
  const conditionsDropped =
    conditionsInPremise.length > 0 && conditionsInHypothesis.length === 0;
  const missingConditionTerms = conditionsDropped ? conditionsInPremise : [];

  let relation: SemanticRelation;
  if (input.scores.contradiction >= 0.5) {
    relation = "contradiction";
  } else if (overclaimTerms.length > 0) {
    relation = "stronger";
  } else if (conditionsDropped) {
    relation = "missing-condition";
  } else if (input.scores.entailment >= 0.7) {
    relation = "equivalent";
  } else {
    relation = "weaker";
  }

  return { relation, missingConditionTerms, overclaimTerms };
}

function reconcileMqm(finding: LocalizedRiskFinding): LocalizedRiskFinding {
  const relation = finding.semanticPreservation?.semanticRelation;
  if (!finding.mqm || !relation) {
    return finding;
  }

  const original = finding.mqm;
  let mqm = original;
  if (relation === "contradiction" || relation === "missing-condition") {
    mqm = { ...mqm, recommendedAction: "change_request" };
  }
  if (
    relation === "missing-condition" &&
    original.errorType === "omission" &&
    original.severity === "minor"
  ) {
    mqm = { ...mqm, severity: "major" };
  }

  return { ...finding, mqm };
}

export async function enrichSemanticPreservation(input: {
  findings: LocalizedRiskFinding[];
  review: { productDescription?: string; disclosure?: string };
  client: NliClient;
  model?: string;
}): Promise<LocalizedRiskFinding[]> {
  const premise = [input.review.productDescription, input.review.disclosure]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");

  const enriched: LocalizedRiskFinding[] = [];

  for (const finding of input.findings) {
    try {
      const scores = await input.client.classify({
        premise,
        hypothesis: finding.originalText
      });
      const { relation, missingConditionTerms, overclaimTerms } = deriveSemanticRelation({
        scores,
        premise,
        hypothesis: finding.originalText
      });

      const semanticPreservation: SemanticPreservation = {
        semanticRelation: relation,
        semanticShiftScore: clamp01(1 - scores.entailment),
        missingConditionTerms,
        overclaimTerms,
        nliProbabilities: scores,
        model: input.model ?? DEFAULT_MODEL
      };

      enriched.push(reconcileMqm({ ...finding, semanticPreservation }));
    } catch {
      enriched.push(finding);
    }
  }

  return enriched;
}
