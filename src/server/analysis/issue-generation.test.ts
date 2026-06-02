import { getReviewCaseById } from "@/domain/reviews";
import type { ReviewCase } from "@/domain/types";
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

  it("uses registered knowledge evidence instead of case history for model subagent findings", () => {
    const review = getReviewCaseById("rc-demo-deposit-001")!;
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-06-02T00:00:00.000Z",
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
          id: "case-history-rc-upload-001",
          sourceType: "case_history",
          title: "rc-upload-001",
          quoteSummary: "과거 유사 심의 사례입니다.",
          relevanceScore: 0.93
        },
        {
          id: "knowledge-financial-consumer-protection-article-21",
          sourceType: "law",
          documentId: "doc-financial-consumer-protection",
          chunkId: "chunk-financial-consumer-protection-21",
          title: "금융소비자 보호에 관한 법률",
          section: "제21조 제3항",
          quoteSummary:
            "금융상품 광고는 소비자가 오인하지 않도록 중요사항과 제한조건을 명확히 표시해야 합니다.",
          relevanceScore: 0.88
        }
      ],
      agentFindings: [
        {
          id: "finding-creative-review-001",
          agent: "creative_review",
          title: "절대적 혜택 표현 확인 필요",
          issueType: "ai_creative_review",
          riskLevel: "high",
          targetText: "누구나 최고 연 5.0%",
          description: "절대 표현이 소비자 오인을 유발할 수 있습니다.",
          suggestedAction: "change_request",
          suggestedCopy: "최고 금리 적용 조건을 함께 표시해 주세요.",
          evidenceCandidateIds: ["case-history-rc-upload-001"],
          confidence: 0.9
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);
    const aiIssue = issues.find((candidate) => candidate.issueType === "ai_creative_review");

    expect(aiIssue?.evidence).toEqual([
      expect.objectContaining({
        sourceType: "law",
        documentId: "doc-financial-consumer-protection",
        chunkId: "chunk-financial-consumer-protection-21",
        title: "금융소비자 보호에 관한 법률",
        section: "제21조 제3항",
        quoteSummary: expect.stringContaining("중요사항과 제한조건")
      })
    ]);
  });

  it("prefers registered knowledge evidence when deterministic issues cite their source", () => {
    const review: ReviewCase = {
      id: "rc-citation-source-001",
      title: "금리 포스터 심의",
      affiliate: "FinProof Bank",
      productType: "deposit",
      channelType: ["web"],
      plannedPublishDate: "2026-06-10",
      status: "analysis_complete",
      highestRiskLevel: "info",
      requester: "마케팅",
      reviewer: "준법감시",
      promotionalCopy: "",
      disclosure: "",
      productDescription: "",
      missingMaterials: [],
      files: [],
      issues: [],
      expectedDraft: ""
    };
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-06-02T00:00:00.000Z",
      extractedDocuments: [
        {
          fileId: "file-poster",
          fileName: "poster.pdf",
          text: "누구나 최고 연 5.0%",
          confidence: 0.94,
          provider: "gemini-ocr"
        }
      ],
      evidenceCandidates: [
        {
          id: "evidence-candidate-poster",
          sourceType: "product_doc",
          title: "poster.pdf",
          quoteSummary: "누구나 최고 연 5.0%",
          relevanceScore: 0.97,
          sourceFileId: "file-poster"
        },
        {
          id: "knowledge-evidence-rate-rule",
          sourceType: "law",
          documentId: "doc-capital-enforcement",
          chunkId: "chunk-capital-enforcement-68-5",
          title: "자본시장법 시행령",
          section: "제68조 제5항",
          quoteSummary:
            "최고 금리와 수익률 광고는 우대 조건, 적용 대상, 제한 사항을 함께 표시해야 합니다.",
          relevanceScore: 0.88
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);
    const absoluteIssue = issues.find((candidate) => candidate.issueType === "absolute_claim");

    expect(absoluteIssue?.evidence[0]).toMatchObject({
      sourceType: "law",
      documentId: "doc-capital-enforcement",
      chunkId: "chunk-capital-enforcement-68-5",
      title: "자본시장법 시행령",
      section: "제68조 제5항"
    });
  });
});
