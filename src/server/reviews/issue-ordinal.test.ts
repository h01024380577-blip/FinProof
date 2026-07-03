import { parseIssueOrdinal, resolveChatIssueByOrdinal, sortIssuesByRisk } from "./issue-ordinal";
import type { ReviewIssue } from "@/domain/types";

function issue(id: string, riskLevel: ReviewIssue["riskLevel"]): ReviewIssue {
  return {
    id,
    title: `이슈 ${id}`,
    issueType: "generic",
    riskLevel,
    status: "open",
    targetText: "",
    description: "",
    suggestedCopy: "",
    sourceAgents: [],
    evidence: []
  } as unknown as ReviewIssue;
}

describe("parseIssueOrdinal", () => {
  it("parses digit + 번 forms", () => {
    expect(parseIssueOrdinal("1번 이슈에 대해 설명해줘")).toBe(1);
    expect(parseIssueOrdinal("2번째 이슈는 뭐야")).toBe(2);
    expect(parseIssueOrdinal("3 번 알려줘")).toBe(3);
    expect(parseIssueOrdinal("이슈 4 설명")).toBe(4);
  });

  it("parses Korean ordinal words", () => {
    expect(parseIssueOrdinal("첫 번째 이슈 설명해줘")).toBe(1);
    expect(parseIssueOrdinal("두번째 이슈는?")).toBe(2);
    expect(parseIssueOrdinal("셋째 항목")).toBe(3);
  });

  it("returns undefined when no ordinal is present", () => {
    expect(parseIssueOrdinal("이 문구 법적으로 문제 있나요?")).toBeUndefined();
    expect(parseIssueOrdinal("우대금리 조건을 어떻게 고지하나요")).toBeUndefined();
  });
});

describe("sortIssuesByRisk", () => {
  it("orders high → caution → info, stable within a level", () => {
    const ordered = sortIssuesByRisk([
      issue("a", "info"),
      issue("b", "high"),
      issue("c", "caution"),
      issue("d", "high")
    ]);
    expect(ordered.map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("resolveChatIssueByOrdinal", () => {
  const issues = [issue("a", "info"), issue("b", "high"), issue("c", "caution")];
  // risk-sorted order: b(1, high), c(2, caution), a(3, info)

  it("switches the target issue to the named number", () => {
    const result = resolveChatIssueByOrdinal(issues, "1번 이슈 설명해줘", issue("a", "info"));
    expect(result.issue.id).toBe("b");
    expect(result.number).toBe(1);
    expect(result.reselectedByOrdinal).toBe(true);
  });

  it("keeps the selected issue when no ordinal is present", () => {
    const selected = issues[2]!; // c
    const result = resolveChatIssueByOrdinal(issues, "이 문구 괜찮나요?", selected);
    expect(result.issue.id).toBe("c");
    expect(result.number).toBe(2);
    expect(result.reselectedByOrdinal).toBe(false);
  });

  it("keeps the selected issue when the number is out of range", () => {
    const selected = issues[0]!; // a
    const result = resolveChatIssueByOrdinal(issues, "9번 이슈 설명", selected);
    expect(result.issue.id).toBe("a");
    expect(result.reselectedByOrdinal).toBe(false);
  });

  it("does not flag reselection when the ordinal points at the already-selected issue", () => {
    const selected = issues[1]!; // b == number 1
    const result = resolveChatIssueByOrdinal(issues, "1번 이슈", selected);
    expect(result.issue.id).toBe("b");
    expect(result.reselectedByOrdinal).toBe(false);
  });
});
