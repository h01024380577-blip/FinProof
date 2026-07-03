import { describe, expect, it } from "vitest";
import { isSocialContextEvidence } from "./social-context";

describe("isSocialContextEvidence", () => {
  it("matches the canonical social-context checklist document titles", () => {
    expect(
      isSocialContextEvidence({
        sourceType: "internal_policy",
        title: "03_문구_캠페인명_체크리스트.md"
      })
    ).toBe(true);
    expect(
      isSocialContextEvidence({
        sourceType: "internal_policy",
        title: "05_소비자정서_금융불안_체크리스트.md"
      })
    ).toBe(true);
  });

  it("matches social issue update documents by identity fields", () => {
    expect(
      isSocialContextEvidence({
        sourceType: "internal_policy",
        documentId: "knowledge-2026_07_사회이슈_업데이트",
        title: "2026년 7월 업데이트 문서"
      })
    ).toBe(true);
  });

  it("does not classify generic financial advertising checklists as social-context evidence", () => {
    expect(
      isSocialContextEvidence({
        sourceType: "internal_policy",
        title: "금융상품 광고 준법심의 공통 체크리스트",
        quoteSummary: "소비자 정서와 사회적 논란 가능성을 고려해 오인 표현을 점검해야 한다."
      })
    ).toBe(false);
    expect(
      isSocialContextEvidence({
        sourceType: "internal_policy",
        title: "예금·적금 광고 심의 체크리스트",
        quoteSummary: "최고 금리 표시 시 우대조건과 기본금리를 병기해야 한다."
      })
    ).toBe(false);
  });

  it("never treats uploaded product documents as approved social-context guidance", () => {
    expect(
      isSocialContextEvidence({
        sourceType: "product_doc",
        title: "03_문구_캠페인명_체크리스트.md"
      })
    ).toBe(false);
  });
});
