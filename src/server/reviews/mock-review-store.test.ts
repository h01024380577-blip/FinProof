import { createMockReviewStore } from "./mock-review-store";

const scope = {
  tenantId: "tenant-demo",
  actorUserId: "user-reviewer-demo",
  actorRole: "reviewer" as const,
  ipAddress: "203.0.113.10"
};

describe("mock review store", () => {
  it("creates a sample-backed review request with AWS-ready file metadata", async () => {
    const store = createMockReviewStore();

    const result = await store.createReviewCaseFromSamplePackage(scope, {
      samplePackageId: "rc-demo-deposit-001"
    });

    expect(result?.reviewCase.id).toBe("rc-demo-deposit-001");
    expect(result?.reviewCase.status).toBe("analysis_waiting");
    expect(result?.analysisStartHref).toBe(
      "/api/v1/review-cases/rc-demo-deposit-001/analysis/start"
    );
    expect(result?.files[0]).toMatchObject({
      id: "file-deposit-poster",
      storageProvider: "sample",
      storageKey: "sample/rc-demo-deposit-001/deposit-poster.png"
    });
    expect(result?.missingMaterials).toEqual(["terms", "internal_checklist"]);
  });

  it("creates an upload-backed review case with deterministic classification metadata", async () => {
    const store = createMockReviewStore();

    const result = await store.createReviewCaseFromUploadedFiles(scope, {
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
      status: "analysis_waiting",
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
    await store.createReviewCaseFromSamplePackage(scope, {
      samplePackageId: "rc-demo-deposit-001"
    });

    const analysis = await store.startAnalysis(scope, "rc-demo-deposit-001");

    expect(analysis).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "analysis_complete",
      issueCount: 3,
      analysisHref: "/reviews/rc-demo-deposit-001",
      jobId: "job-rc-demo-deposit-001-001"
    });

    const latestJob = await store.getLatestAnalysisJob(scope, "rc-demo-deposit-001");

    expect(latestJob).toMatchObject({
      id: "job-rc-demo-deposit-001-001",
      reviewCaseId: "rc-demo-deposit-001",
      status: "completed",
      progress: 100
    });

    const updatedIssue = await store.saveIssueDecision(scope, {
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

    const review = await store.getReviewCase(scope, "rc-demo-deposit-001");

    expect(review?.issues[0]).toMatchObject({
      reviewerRiskLevel: "reject_recommended",
      finalAction: "change_request",
      reviewerComment: "우대 조건 병기 필요"
    });
  });

  it("updates review case status for final reviewer action", async () => {
    const store = createMockReviewStore();
    await store.createReviewCaseFromSamplePackage(scope, {
      samplePackageId: "rc-demo-deposit-001"
    });

    const updatedReview = await store.updateReviewStatus(
      scope,
      "rc-demo-deposit-001",
      "change_requested"
    );

    expect(updatedReview).toMatchObject({
      id: "rc-demo-deposit-001",
      status: "change_requested"
    });
    await expect(store.updateReviewStatus(scope, "missing-case", "change_requested")).resolves.toBe(
      undefined
    );
  });

  it("saves opinion draft versions for generated and manually edited drafts", async () => {
    const store = createMockReviewStore();
    await store.createReviewCaseFromSamplePackage(scope, {
      samplePackageId: "rc-demo-deposit-001"
    });

    const generatedDraft = await store.saveOpinionDraft(
      scope,
      "rc-demo-deposit-001",
      "생성된 수정 요청 의견 초안"
    );
    const editedDraft = await store.saveOpinionDraft(
      scope,
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
    await expect(store.saveOpinionDraft(scope, "missing-case", "초안")).resolves.toBeUndefined();
  });

  it("records and filters audit events", async () => {
    const store = createMockReviewStore();

    await store.recordAuditEvent(scope, {
      action: "analysis.start",
      targetType: "review_case",
      targetId: "rc-demo-deposit-001",
      beforeValue: { status: "analysis_waiting" },
      afterValue: { status: "analysis_complete" }
    });

    const auditEvents = await store.listAuditEvents(scope, {
      targetType: "review_case",
      targetId: "rc-demo-deposit-001"
    });

    expect(auditEvents[0]).toMatchObject({
      action: "analysis.start",
      targetType: "review_case",
      targetId: "rc-demo-deposit-001",
      userId: "user-reviewer-demo",
      ipAddress: "203.0.113.10"
    });
  });
});
