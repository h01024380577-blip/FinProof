import { getReviewCaseById } from "@/domain/reviews";
import type { AnalysisArtifacts } from "./review-analysis-pipeline";
import { buildAnalysisIssues } from "./issue-generation";

describe("issue generation", () => {
  it("projects multilingual context from agent findings to review issues", () => {
    const review = getReviewCaseById("rc-demo-loan-001")!;
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
      agentFindings: [
        {
          id: "finding-multilingual-001",
          agent: "korean_compliance_mapping",
          issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
          riskLevel: "reject_recommended",
          title: "승인 보장 오인 표현",
          targetText: "Guaranteed approval in 3 minutes",
          description: "심사와 무관하게 승인이 확정되는 것처럼 해석될 수 있음",
          suggestedAction: "change_request",
          suggestedCopy: "Apply in 3 minutes. Approval is subject to credit review.",
          evidenceCandidateIds: ["ev-approval"],
          confidence: 0.91,
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

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues[0].multilingualContext).toEqual({
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
  });

  it("turns model subagent findings into review issues with matched evidence", () => {
    const review = getReviewCaseById("rc-demo-deposit-001")!;
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-05-26T00:00:00.000Z",
      extractedDocuments: [
        {
          fileId: "file-upload-001",
          fileName: "poster.txt",
          text: "누구나 최고 연 5.0%",
          confidence: 0.95,
          provider: "fixture"
        }
      ],
      evidenceCandidates: [
        {
          id: "evidence-candidate-file-upload-001-001",
          sourceType: "product_doc",
          title: "poster.txt",
          quoteSummary: "누구나 최고 연 5.0%",
          relevanceScore: 0.92,
          sourceFileId: "file-upload-001"
        }
      ],
      agentFindings: [
        {
          id: "finding-creative_review-001",
          agent: "creative_review",
          title: "최고 금리 조건 병기 필요",
          issueType: "ai_creative_review",
          riskLevel: "high",
          targetText: "누구나 최고 연 5.0%",
          description: "절대 표현과 최고 금리 표현이 함께 있어 조건 고지가 필요합니다.",
          suggestedAction: "change_request",
          suggestedCopy: "최고 연 5.0%는 우대 조건 충족 시 적용됩니다.",
          evidenceCandidateIds: ["evidence-candidate-file-upload-001-001"],
          confidence: 0.88
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueType: "ai_creative_review",
          title: "최고 금리 조건 병기 필요",
          sourceAgents: ["creative_review"],
          suggestedAction: "change_request",
          evidence: [
            expect.objectContaining({
              title: "poster.txt",
              quoteSummary: "누구나 최고 연 5.0%"
            })
          ]
        })
      ])
    );
  });
});
