import { createMockReviewStore } from "./mock-review-store";

describe("mock review store", () => {
  it("creates a sample-backed review request with AWS-ready file metadata", async () => {
    const store = createMockReviewStore();

    const result = await store.createReviewCaseFromSamplePackage({
      samplePackageId: "rc-demo-deposit-001"
    });

    expect(result.reviewCase.id).toBe("rc-demo-deposit-001");
    expect(result.reviewCase.status).toBe("submitted");
    expect(result.analysisStartHref).toBe(
      "/api/v1/review-cases/rc-demo-deposit-001/analysis/start"
    );
    expect(result.files[0]).toMatchObject({
      id: "file-deposit-poster",
      storageProvider: "sample",
      storageKey: "sample/rc-demo-deposit-001/deposit-poster.png"
    });
    expect(result.missingMaterials).toEqual(["terms", "internal_checklist"]);
  });

  it("runs deterministic analysis and persists reviewer issue decisions", async () => {
    const store = createMockReviewStore();
    await store.createReviewCaseFromSamplePackage({ samplePackageId: "rc-demo-deposit-001" });

    const analysis = await store.startAnalysis("rc-demo-deposit-001");

    expect(analysis).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "analysis_complete",
      issueCount: 3,
      analysisHref: "/reviews/rc-demo-deposit-001"
    });

    const updatedIssue = await store.saveIssueDecision({
      reviewCaseId: "rc-demo-deposit-001",
      issueId: "issue-deposit-rate",
      reviewerRiskLevel: "reject_recommended",
      finalAction: "change_request",
      reviewerComment: "우대 조건 병기 필요"
    });

    expect(updatedIssue).toMatchObject({
      id: "issue-deposit-rate",
      reviewerRiskLevel: "reject_recommended",
      finalAction: "change_request",
      reviewerComment: "우대 조건 병기 필요"
    });

    const review = await store.getReviewCase("rc-demo-deposit-001");

    expect(review?.issues[0]).toMatchObject({
      reviewerRiskLevel: "reject_recommended",
      finalAction: "change_request",
      reviewerComment: "우대 조건 병기 필요"
    });
  });
});
