import {
  getIssueCounts,
  getReviewCaseById,
  getReviewSummaries,
  getRiskFilteredIssues,
  riskLabels,
  reviewCases
} from "./reviews";

describe("review sample data", () => {
  it("contains the two Demo MVP cases from the handoff", () => {
    expect(reviewCases).toHaveLength(2);
    expect(getReviewSummaries().map((review) => review.id)).toEqual([
      "rc-demo-deposit-001",
      "rc-demo-loan-001"
    ]);
  });

  it("returns deposit detail with highlighted rate and misleading expression issues", () => {
    const review = getReviewCaseById("rc-demo-deposit-001");

    expect(review?.title).toBe("최고 연 5.0% 적금 홍보물 심의");
    expect(review?.issues.map((issue) => issue.targetText)).toEqual(
      expect.arrayContaining(["최고 연 5.0%", "누구나 최고금리 혜택"])
    );
  });

  it("filters issues by risk level", () => {
    const highIssues = getRiskFilteredIssues("rc-demo-deposit-001", "high");

    expect(highIssues).toHaveLength(2);
    expect(highIssues.every((issue) => issue.riskLevel === "high")).toBe(true);
  });

  it("uses only the three reviewer-facing AI risk levels", () => {
    const riskLevels = Object.keys(riskLabels);

    expect(riskLevels).toEqual(["info", "caution", "high"]);
    expect(riskLabels).toEqual({
      info: "참고",
      caution: "주의",
      high: "위험"
    });

    for (const review of reviewCases) {
      expect(review.highestRiskLevel).not.toBe("reject_recommended");
      expect(getIssueCounts(review)).not.toHaveProperty("reject_recommended");
      expect(review.issues.map((issue) => issue.riskLevel)).not.toContain("reject_recommended");
    }
  });
});
