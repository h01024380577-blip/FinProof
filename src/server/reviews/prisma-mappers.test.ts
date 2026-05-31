import { toReviewCase, toReviewSummary } from "./prisma-mappers";

const row = {
  id: "rc-demo-deposit-001",
  affiliateName: "광주은행",
  title: "최고 연 5.0% 적금 홍보물 심의",
  productType: "deposit" as const,
  channelType: ["poster", "sns"],
  plannedPublishDate: new Date("2026-06-10T00:00:00.000Z"),
  status: "analysis_complete" as const,
  highestRiskLevel: "high" as const,
  requesterName: "업로드 요청자",
  reviewerName: "준법심의자 박민준",
  promotionalCopy: "최고 연 5.0%",
  disclosure: "우대 조건 있음",
  productDescription: "정기적금",
  missingMaterials: ["terms"],
  expectedDraft: "수정 요청 초안",
  currentDraft: "현재 초안",
  currentDraftVersion: 2,
  analysisNotice: null,
  files: [
    {
      id: "file-deposit-poster",
      originalFilename: "deposit-poster.png",
      fileType: "promotional_creative" as const,
      classificationConfidence: 0.91,
      parseStatus: "parsed" as const,
      storageProvider: "sample" as const,
      storageKey: "sample/rc-demo-deposit-001/deposit-poster.png",
      contentType: "image/png",
      sizeBytes: BigInt(1024)
    }
  ],
  issues: [
    {
      id: "issue-deposit-rate",
      issueType: "RATE_DISPLAY_RISK",
      riskLevel: "high" as const,
      reviewerRiskLevel: null,
      title: "최고금리 조건 표시 불충분",
      targetText: "최고 연 5.0%",
      targetBbox: [120, 230, 420, 290],
      targetFileId: null,
      targetPage: null,
      confidence: null,
      agentFindingId: null,
      agentFinding: {
        outputSnapshot: {
          localizedRiskFinding: {
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
            localizedFindingId: "seg-en-001",
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
            koreanComplianceCategory: "승인 보장 오인 표현",
            koreanComplianceReason: "대출 승인 가능성을 확정적으로 고지하는 표현으로 볼 수 있음",
            evidenceQuery: "대출 광고 승인 보장 금지 표현",
            suggestedAction: "change_request"
          }
        }
      },
      sourceAgents: ["product_terms_agent"],
      suggestedAction: "change_request" as const,
      finalAction: null,
      reviewerComment: null,
      status: "open" as const,
      description: "조건 표시가 약함",
      suggestedCopy: "조건을 병기",
      evidence: [
        {
          id: "ev-deposit-product",
          sourceType: "product_doc" as const,
          documentId: null,
          chunkId: null,
          version: null,
          effectiveFrom: null,
          title: "정기적금 상품설명서",
          page: 3,
          section: "우대금리 조건",
          quoteSummary: "우대 조건 충족 시 적용",
          relevanceScore: 0.87
        }
      ]
    }
  ]
};

describe("prisma review mappers", () => {
  it("maps a review case row to the existing domain type", () => {
    expect(toReviewCase(row)).toMatchObject({
      id: "rc-demo-deposit-001",
      affiliate: "광주은행",
      productType: "deposit",
      plannedPublishDate: "2026-06-10",
      currentDraftVersion: 2,
      files: [
        {
          name: "deposit-poster.png",
          storageKey: "sample/rc-demo-deposit-001/deposit-poster.png",
          sizeBytes: 1024
        }
      ],
      issues: [
        {
          id: "issue-deposit-rate",
          multilingualContext: {
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
            suggestedCopyOriginalLanguage:
              "Apply in 3 minutes. Approval is subject to credit review.",
            suggestedCopyKoreanMeaning:
              "3분 신청 가능. 승인은 신용심사 결과에 따라 달라질 수 있음."
          },
          evidence: [{ id: "ev-deposit-product" }]
        }
      ]
    });
  });

  it("maps a review summary row", () => {
    expect(toReviewSummary(row)).toEqual({
      id: "rc-demo-deposit-001",
      title: "최고 연 5.0% 적금 홍보물 심의",
      affiliate: "광주은행",
      productType: "deposit",
      plannedPublishDate: "2026-06-10",
      status: "analysis_complete",
      highestRiskLevel: "high",
      requester: "업로드 요청자",
      reviewer: "준법심의자 박민준"
    });
  });
});
