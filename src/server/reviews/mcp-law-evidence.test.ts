import { describe, expect, it } from "vitest";
import { mapLawTextToEvidence } from "./mcp-law-evidence";

describe("mapLawTextToEvidence", () => {
  it("maps MCP law text into a law-sourced Evidence with effective date and 현행 section", () => {
    const evidence = mapLawTextToEvidence(
      { lawId: "123456", title: "전자금융거래법" },
      {
        text: "시행일: 2026-07-01\n[현행]\n제1조(목적) 이 법은 ...",
        effectiveFrom: "2026-07-01",
        isCurrent: true
      },
      "전자금융거래법"
    );

    expect(evidence.id).toBe("law-mcp-123456");
    expect(evidence.sourceType).toBe("law");
    expect(evidence.title).toBe("전자금융거래법");
    expect(evidence.effectiveFrom).toBe("2026-07-01");
    expect(evidence.section).toBe("[현행]");
    expect(evidence.quoteSummary).toContain("제1조");
    expect(evidence.relevanceScore).toBeGreaterThan(0.5);
  });

  it("truncates quoteSummary to at most 600 characters for long law text", () => {
    const longText = "제1조 ".repeat(300);
    const evidence = mapLawTextToEvidence(
      { lawId: "999999", title: "테스트법" },
      { text: longText, isCurrent: false },
      "테스트법"
    );
    expect(evidence.quoteSummary.length).toBeLessThanOrEqual(600);
  });

  it("falls back to the searched law name when the search result has no title", () => {
    const evidence = mapLawTextToEvidence(
      { mst: "267581" },
      { text: "제2조 ...", isCurrent: false },
      "어떤 규정법"
    );

    expect(evidence.id).toBe("law-mcp-267581");
    expect(evidence.title).toBe("어떤 규정법");
    expect(evidence.section).toBeUndefined();
    expect(evidence.effectiveFrom).toBeUndefined();
  });
});
