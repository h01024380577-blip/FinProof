import { describe, expect, it } from "vitest";
import type { NliClient, NliScores } from "@/server/ai/nli-client";
import type { LocalizedRiskFinding } from "./multilingual";
import { deriveSemanticRelation, enrichSemanticPreservation } from "./semantic-preservation";

function stubClient(scores: NliScores): NliClient {
  return { classify: async () => scores };
}

const baseFinding: LocalizedRiskFinding = {
  id: "f1",
  segmentId: "seg-en-001",
  language: "en",
  originalText: "Guaranteed approval at 4.9% for everyone.",
  literalTranslation: "누구나 4.9% 승인 보장",
  complianceMeaning: "승인 확정처럼 표현합니다.",
  riskCategory: "both",
  riskSignals: ["guaranteed approval"],
  riskLevelHint: "caution",
  suggestedCopyOriginalLanguage: "Approval may vary after review.",
  suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
  confidence: 0.8,
  mqm: {
    errorType: "omission",
    complianceRiskType: "required_disclosure_missing",
    severity: "minor",
    targetSpan: "Guaranteed approval",
    evidenceType: "product_doc",
    recommendedAction: "hold"
  }
};

const review = {
  productDescription: "대출은 신용심사 결과에 따라 승인 여부와 금리가 달라질 수 있습니다.",
  disclosure: "심사 결과에 따라 달라질 수 있음"
};

describe("deriveSemanticRelation", () => {
  it("returns contradiction when contradiction probability dominates", () => {
    const result = deriveSemanticRelation({
      scores: { entailment: 0.1, neutral: 0.2, contradiction: 0.7 },
      premise: review.productDescription,
      hypothesis: "Guaranteed approval for everyone."
    });
    expect(result.relation).toBe("contradiction");
  });

  it("flags overclaim as stronger", () => {
    const result = deriveSemanticRelation({
      scores: { entailment: 0.4, neutral: 0.4, contradiction: 0.2 },
      premise: review.productDescription,
      hypothesis: "Guaranteed approval for everyone."
    });
    expect(result.relation).toBe("stronger");
    expect(result.overclaimTerms).toContain("guaranteed");
  });

  it("flags dropped conditions as missing-condition", () => {
    const result = deriveSemanticRelation({
      scores: { entailment: 0.45, neutral: 0.45, contradiction: 0.1 },
      premise: review.productDescription,
      hypothesis: "Approval at 4.9%."
    });
    expect(result.relation).toBe("missing-condition");
    expect(result.missingConditionTerms.length).toBeGreaterThan(0);
  });

  it("returns equivalent on high entailment with no term drift", () => {
    const result = deriveSemanticRelation({
      scores: { entailment: 0.85, neutral: 0.1, contradiction: 0.05 },
      premise: review.productDescription,
      hypothesis: "Approval and rate depend on credit review."
    });
    expect(result.relation).toBe("equivalent");
  });
});

describe("enrichSemanticPreservation", () => {
  it("attaches semanticPreservation and preserves mqm action on stronger", async () => {
    const [enriched] = await enrichSemanticPreservation({
      findings: [baseFinding],
      review,
      client: stubClient({ entailment: 0.2, neutral: 0.5, contradiction: 0.3 })
    });

    expect(enriched.semanticPreservation?.semanticRelation).toBe("stronger");
    expect(enriched.semanticPreservation?.semanticShiftScore).toBeCloseTo(0.8, 5);
    expect(enriched.semanticPreservation?.model).toBe("mDeBERTa-v3-base-mnli-xnli");
    expect(enriched.mqm?.recommendedAction).toBe("hold");
  });

  it("keeps the original finding when the NLI client throws", async () => {
    const failingClient: NliClient = {
      classify: async () => {
        throw new Error("service down");
      }
    };

    const [enriched] = await enrichSemanticPreservation({
      findings: [baseFinding],
      review,
      client: failingClient
    });

    expect(enriched.semanticPreservation).toBeUndefined();
    expect(enriched.mqm).toEqual(baseFinding.mqm);
  });
});
