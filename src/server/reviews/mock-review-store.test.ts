import { createMockReviewStore } from "./mock-review-store";
import type { AnalysisArtifacts } from "@/server/analysis/review-analysis-pipeline";

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

  it("persists multilingual issue context and agent finding snapshots", async () => {
    const store = createMockReviewStore();
    await store.createReviewCaseFromUploadedFiles(scope, {
      reviewCaseId: "rc-multilingual-test",
      title: "다국어 대출 광고",
      affiliate: "광주은행",
      productType: "loan",
      channelType: ["poster"],
      plannedPublishDate: "2026-06-20",
      files: [
        {
          id: "file-loan-poster",
          name: "loan-poster.txt",
          type: "text/plain",
          size: 1024
        }
      ]
    });
    await store.enqueueAnalysis(scope, "rc-multilingual-test");
    const claimedJob = await store.claimNextAnalysisJob(scope.tenantId, "worker-test");
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-05-26T00:00:00.000Z",
      extractedDocuments: [
        {
          fileId: "file-loan-poster",
          fileName: "loan-poster.txt",
          text: "Guaranteed approval in 3 minutes",
          confidence: 0.95,
          provider: "fixture"
        }
      ],
      evidenceCandidates: [
        {
          id: "ev-approval",
          sourceType: "product_doc",
          title: "loan-poster.txt",
          quoteSummary: "Guaranteed approval in 3 minutes",
          relevanceScore: 0.93,
          sourceFileId: "file-loan-poster"
        }
      ],
      findings: [
        {
          agentType: "english_translator_risk",
          issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
          riskLevel: "reject_recommended",
          title: "승인 보장 오인 표현",
          targetText: "Guaranteed approval in 3 minutes",
          targetBbox: [0, 0, 0, 0],
          description: "심사와 무관하게 승인이 확정되는 것처럼 해석될 수 있음",
          suggestedAction: "change_request",
          suggestedCopy: "Apply in 3 minutes. Approval is subject to credit review.",
          confidence: 0.91,
          evidence: [
            {
              id: "ev-approval",
              sourceType: "product_doc",
              title: "loan-poster.txt",
              quoteSummary: "Guaranteed approval in 3 minutes",
              relevanceScore: 0.93,
              sourceFileId: "file-loan-poster"
            }
          ],
          localizedRiskFinding: {
            id: "risk-en-approval",
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval in 3 minutes",
            literalTranslation: "3분 안에 승인 보장",
            complianceMeaning: "심사와 무관하게 승인 확정처럼 해석될 수 있음",
            riskCategory: "both",
            riskSignals: ["approval_guarantee"],
            riskLevelHint: "reject_recommended",
            suggestedCopyOriginalLanguage:
              "Apply in 3 minutes. Approval is subject to credit review.",
            suggestedCopyKoreanMeaning:
              "3분 신청 가능. 승인은 신용심사 결과에 따라 달라질 수 있음.",
            confidence: 0.91
          },
          koreanComplianceMapping: {
            localizedFindingId: "risk-en-approval",
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
            koreanComplianceCategory: "승인 보장 오인 표현",
            koreanComplianceReason: "대출 승인 가능성을 확정적으로 고지하는 표현으로 볼 수 있음",
            evidenceQuery: "대출 광고 승인 보장 금지 표현",
            suggestedAction: "change_request"
          }
        }
      ]
    };

    await expect(
      store.persistAnalysisOutputs(scope, {
        reviewCaseId: "rc-multilingual-test",
        jobId: claimedJob!.id,
        artifacts
      })
    ).resolves.toEqual({ issueCount: 1, evidenceCount: 1 });

    const review = await store.getReviewCase(scope, "rc-multilingual-test");
    const findings = await store.listAgentFindingsForTest(scope, "rc-multilingual-test");

    expect(review?.issues[0].multilingualContext).toEqual({
      segmentId: "seg-en-001",
      language: "en",
      originalText: "Guaranteed approval in 3 minutes",
      literalTranslation: "3분 안에 승인 보장",
      complianceMeaning: "심사와 무관하게 승인 확정처럼 해석될 수 있음",
      riskCategory: "both",
      riskSignals: ["approval_guarantee"],
      koreanComplianceCategory: "승인 보장 오인 표현",
      koreanComplianceReason: "대출 승인 가능성을 확정적으로 고지하는 표현으로 볼 수 있음",
      evidenceQuery: "대출 광고 승인 보장 금지 표현",
      suggestedCopyOriginalLanguage: "Apply in 3 minutes. Approval is subject to credit review.",
      suggestedCopyKoreanMeaning: "3분 신청 가능. 승인은 신용심사 결과에 따라 달라질 수 있음."
    });
    expect(findings[0]).toMatchObject({
      localizedRiskFinding: expect.objectContaining({ segmentId: "seg-en-001" }),
      koreanComplianceMapping: expect.objectContaining({
        localizedFindingId: "risk-en-approval"
      })
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
