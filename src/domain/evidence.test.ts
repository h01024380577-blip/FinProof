import { describe, expect, it } from "vitest";
import { filterMatchedEvidence, isMatchedEvidence } from "./evidence";

describe("isMatchedEvidence", () => {
  it("keeps registered knowledge evidence above the lower knowledge floor", () => {
    // The reranker under-scores Korean regulation text; on-point law/internal_policy
    // evidence in [0.1, 0.5) must survive read-back instead of being stripped.
    expect(isMatchedEvidence({ relevanceScore: 0.2, sourceType: "internal_policy" })).toBe(true);
    expect(isMatchedEvidence({ relevanceScore: 0.2, sourceType: "law" })).toBe(true);
  });

  it("drops registered knowledge evidence below the knowledge floor", () => {
    expect(isMatchedEvidence({ relevanceScore: 0.05, sourceType: "internal_policy" })).toBe(false);
  });

  it("keeps the standard 0.5 floor for product_doc / case_history", () => {
    expect(isMatchedEvidence({ relevanceScore: 0.2, sourceType: "product_doc" })).toBe(false);
    expect(isMatchedEvidence({ relevanceScore: 0.2, sourceType: "case_history" })).toBe(false);
    expect(isMatchedEvidence({ relevanceScore: 0.6, sourceType: "product_doc" })).toBe(true);
  });
});

describe("filterMatchedEvidence", () => {
  it("retains under-scored knowledge evidence but drops under-scored product docs", () => {
    const filtered = filterMatchedEvidence([
      { relevanceScore: 0.2, sourceType: "internal_policy" as const },
      { relevanceScore: 0.2, sourceType: "product_doc" as const }
    ]);

    expect(filtered).toEqual([{ relevanceScore: 0.2, sourceType: "internal_policy" }]);
  });
});
