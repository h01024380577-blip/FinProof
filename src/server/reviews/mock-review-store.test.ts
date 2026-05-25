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

  it("creates an upload-backed review case with deterministic classification metadata", async () => {
    const store = createMockReviewStore();

    const result = await store.createReviewCaseFromUploadedFiles({
      title: "실제 업로드 적금 홍보물",
      affiliate: "광주은행",
      productType: "deposit",
      channelType: ["poster"],
      plannedPublishDate: "2026-06-20",
      files: [
        {
          name: "real-deposit-poster.png",
          type: "image/png",
          size: 2048
        },
        {
          name: "real-deposit-rate-table.xlsx",
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 4096
        },
        {
          name: "real-review-package.zip",
          type: "application/zip",
          size: 8192
        }
      ]
    });

    expect(result.reviewCase).toMatchObject({
      id: "rc-upload-001",
      title: "실제 업로드 적금 홍보물",
      status: "submitted",
      highestRiskLevel: "info",
      analysisNotice: "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다."
    });
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "real-deposit-poster.png",
          fileType: "promotional_creative",
          parseStatus: "pending",
          storageProvider: "local",
          storageKey: "local/rc-upload-001/real-deposit-poster.png",
          sizeBytes: 2048
        }),
        expect.objectContaining({
          name: "real-deposit-rate-table.xlsx",
          fileType: "rate_table"
        }),
        expect.objectContaining({
          name: "real-review-package.zip",
          fileType: "package_archive",
          parseStatus: "pending",
          storageProvider: "local"
        })
      ])
    );
    expect(result.missingMaterials).toEqual(
      expect.arrayContaining(["copy_draft", "product_description", "internal_checklist"])
    );
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

  it("updates review case status for final reviewer action", async () => {
    const store = createMockReviewStore();
    await store.createReviewCaseFromSamplePackage({ samplePackageId: "rc-demo-deposit-001" });

    const updatedReview = await store.updateReviewStatus("rc-demo-deposit-001", "change_requested");

    expect(updatedReview).toMatchObject({
      id: "rc-demo-deposit-001",
      status: "change_requested"
    });
    await expect(store.updateReviewStatus("missing-case", "change_requested")).resolves.toBe(
      undefined
    );
  });

  it("saves opinion draft versions for generated and manually edited drafts", async () => {
    const store = createMockReviewStore();
    await store.createReviewCaseFromSamplePackage({ samplePackageId: "rc-demo-deposit-001" });

    const generatedDraft = await store.saveOpinionDraft(
      "rc-demo-deposit-001",
      "생성된 수정 요청 의견 초안"
    );
    const editedDraft = await store.saveOpinionDraft(
      "rc-demo-deposit-001",
      "Reviewer가 편집한 수정 요청 의견 초안"
    );

    expect(generatedDraft).toMatchObject({
      currentDraft: "생성된 수정 요청 의견 초안",
      currentDraftVersion: 1
    });
    expect(editedDraft).toMatchObject({
      currentDraft: "Reviewer가 편집한 수정 요청 의견 초안",
      currentDraftVersion: 2
    });
    await expect(store.saveOpinionDraft("missing-case", "초안")).resolves.toBeUndefined();
  });
});
