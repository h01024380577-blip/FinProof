import { getReviewCaseById } from "./reviews";
import { generateReviewReport } from "./reports";

describe("generateReviewReport", () => {
  it("builds a markdown report from the selected issues, draft, and evidence", () => {
    const review = {
      ...getReviewCaseById("rc-demo-deposit-001")!,
      currentDraft: "저장된 수정 요청 의견 초안"
    };

    const report = generateReviewReport({
      review,
      reportType: "change_request",
      tone: "formal",
      includeChatContext: true,
      issueIds: ["issue-deposit-rate"],
      draft: "현재 편집된 수정 요청 의견 초안"
    });

    expect(report).toMatchObject({
      reportId: "report-rc-demo-deposit-001-v1",
      version: 1
    });
    expect(report.contentMarkdown).toContain("# 최고 연 5.0% 적금 홍보물 심의 리포트");
    expect(report.contentMarkdown).toContain("현재 편집된 수정 요청 의견 초안");
    expect(report.contentMarkdown).toContain("최고금리 조건 표시 불충분");
    expect(report.contentMarkdown).toContain("최고 연 5.0%");
    expect(report.contentMarkdown).toContain("정기적금 상품설명서");
    expect(report.evidenceIds).toEqual(["ev-deposit-product", "ev-deposit-policy"]);
  });
});
