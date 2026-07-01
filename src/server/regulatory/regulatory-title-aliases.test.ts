import { describe, expect, it } from "vitest";
import { resolveTrackingTitle } from "./regulatory-title-aliases";

describe("resolveTrackingTitle", () => {
  it("maps a known alias to its official law name", () => {
    expect(resolveTrackingTitle("여신전문금융업법 (원문)")).toEqual({
      kind: "alias",
      officialTitle: "여신전문금융업법"
    });
  });

  it("treats '정식명 — 용도' curation excerpts as excerpt (not tracked)", () => {
    expect(resolveTrackingTitle("은행법 — 예금·대출 광고 및 금리 표시")).toEqual({ kind: "excerpt" });
    expect(resolveTrackingTitle("자본시장법 — 투자성 상품 광고 규제")).toEqual({ kind: "excerpt" });
    expect(resolveTrackingTitle("금융소비자 보호에 관한 법률 시행령 — 광고 세부기준")).toEqual({
      kind: "excerpt"
    });
  });

  it("passes through official law titles unchanged", () => {
    expect(resolveTrackingTitle("자본시장과 금융투자업에 관한 법률 시행령")).toEqual({
      kind: "passthrough"
    });
    expect(resolveTrackingTitle("은행업감독규정")).toEqual({ kind: "passthrough" });
  });

  it("does not misclassify a middot title as an excerpt", () => {
    // 가운뎃점(·)은 발췌 마커가 아니다 — 공백+대시+공백만 발췌로 본다.
    expect(resolveTrackingTitle("추천·보증 등에 관한 표시·광고 심사지침")).toEqual({
      kind: "passthrough"
    });
  });
});
