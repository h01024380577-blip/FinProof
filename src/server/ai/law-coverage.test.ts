import { describe, expect, it } from "vitest";
import { assessLawCoverage, extractLawName, extractLawNameFromIssue } from "./law-coverage";
import type { Evidence } from "@/domain/types";

function lawEvidence(title: string, score: number): Evidence {
  return {
    id: `ev-${title}`,
    sourceType: "law",
    title,
    quoteSummary: "요약",
    relevanceScore: score
  };
}

describe("extractLawName", () => {
  it("extracts a contiguous law token", () => {
    expect(extractLawName("전자금융거래법에서 관련 조항 찾아줘")).toBe("전자금융거래법");
  });

  it("extracts an '…에 관한 법률' form", () => {
    expect(extractLawName("금융소비자 보호에 관한 법률 조항 알려줘")).toBe("금융소비자 보호에 관한 법률");
  });

  it("extracts a spaced two-part short name in full", () => {
    expect(extractLawName("개인정보 보호법 조항 찾아줘")).toBe("개인정보 보호법");
  });

  it("returns undefined when no law name is present", () => {
    expect(extractLawName("이 문구 더 짧게 해줘")).toBeUndefined();
  });
});

describe("extractLawNameFromIssue", () => {
  it("falls back to the issue description when the question is generic", () => {
    expect(
      extractLawNameFromIssue({
        title: "예금자보호 문구 불일치",
        description: "광고에는 예금자보호법 적용이라 되어 있으나 상품설명서와 배치됩니다.",
        targetText: "이 상품은 보호되지 않습니다"
      })
    ).toBe("예금자보호법");
  });

  it("prefers the title, then description, then target text", () => {
    expect(
      extractLawNameFromIssue({
        title: "전자금융거래법 위반 소지",
        description: "개인정보 보호법 관련 내용"
      })
    ).toBe("전자금융거래법");
  });

  it("returns undefined when no law name appears anywhere", () => {
    expect(
      extractLawNameFromIssue({ title: "문구 오인", description: "짧게 수정 필요" })
    ).toBeUndefined();
  });
});

describe("assessLawCoverage", () => {
  const minScore = 0.5;

  it("is covered when a matching law evidence is above threshold", () => {
    expect(
      assessLawCoverage([lawEvidence("전자금융거래법", 0.8)], "전자금융거래법 조항 찾아줘", minScore)
    ).toBe(true);
  });

  it("is not covered when no law evidence matches the requested law name", () => {
    expect(
      assessLawCoverage([lawEvidence("금융소비자보호법", 0.8)], "전자금융거래법 조항 찾아줘", minScore)
    ).toBe(false);
  });

  it("is not covered when there is no authoritative evidence at all", () => {
    expect(assessLawCoverage([], "전자금융거래법 조항 찾아줘", minScore)).toBe(false);
  });

  it("is not covered when matching evidence is below threshold", () => {
    expect(
      assessLawCoverage([lawEvidence("전자금융거래법", 0.3)], "전자금융거래법 조항 찾아줘", minScore)
    ).toBe(false);
  });

  it("does not treat a different 보호법 as coverage for a spaced law name", () => {
    expect(
      assessLawCoverage([lawEvidence("금융소비자보호법", 0.8)], "개인정보 보호법 조항 찾아줘", minScore)
    ).toBe(false);
  });
});
