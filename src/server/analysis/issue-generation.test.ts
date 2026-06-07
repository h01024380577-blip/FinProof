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
          riskLevel: "high",
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
            riskLevelHint: "high",
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

  it("does not attach model-selected evidence below the matching threshold", () => {
    const review = getReviewCaseById("rc-demo-loan-001")!;
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-06-05T00:00:00.000Z",
      extractedDocuments: [
        {
          fileId: "file-upload-001",
          fileName: "loan-copy.txt",
          text: "신청 즉시 100% 당일 승인",
          confidence: 0.95,
          provider: "fixture"
        }
      ],
      evidenceCandidates: [
        {
          id: "knowledge-low-score-guideline",
          sourceType: "internal_policy",
          documentId: "knowledge-low-score-guideline",
          chunkId: "chunk-low-score-guideline-011",
          title: "금융규제 가이드라인",
          quoteSummary: "추천·보증 등의 내용은 실제 경험한 사실에 부합하여야 한다.",
          relevanceScore: 0.03
        }
      ],
      agentFindings: [
        {
          id: "finding-main-001",
          agent: "main",
          title: "확정적 승인 보장 표현",
          issueType: "guarantee",
          riskLevel: "reject_recommended",
          targetText: "신청 즉시 100% 당일 승인",
          description: "승인이 보장되는 것처럼 오인시킬 수 있습니다.",
          suggestedAction: "reject",
          suggestedCopy: "심사 결과에 따라 승인 여부가 달라질 수 있습니다.",
          evidenceCandidateIds: ["knowledge-low-score-guideline"],
          confidence: 0.86
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues[0]).toMatchObject({
      riskLevel: "high",
      suggestedAction: "change_request"
    });
    expect(issues[0].evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: "knowledge-low-score-guideline",
          relevanceScore: 0.03
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

  it("prefers article body knowledge evidence over table-of-contents chunks", () => {
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
          id: "knowledge-financial-ad-guideline-toc",
          sourceType: "internal_policy",
          documentId: "doc-financial-ad-guideline",
          chunkId: "chunk-financial-ad-guideline-toc",
          title: "금융규제 가이드라인",
          quoteSummary:
            "별첨자료 금융광고규제 가이드라인 2021. 6. 8. 목 차 Ⅰ. 금소법 제정에 따른 광고규제 변화 · ·· ·· ·· ·· ·· 1 Ⅱ. 광고규제 적용대상 · ·· ·· ·· ·· ·· 3",
          relevanceScore: 0.96
        },
        {
          id: "knowledge-financial-ad-guideline-8-3",
          sourceType: "internal_policy",
          documentId: "doc-financial-ad-guideline",
          chunkId: "chunk-financial-ad-guideline-8-3",
          title: "금융규제 가이드라인",
          quoteSummary:
            "금소법 시행령 제8조제3항 각 호의 내용 중 일부를 제외함으로 인해 금융소비자의 합리적 의사결정이 저해될 우려가 없을 것",
          relevanceScore: 0.79
        }
      ],
      agentFindings: [
        {
          id: "finding-creative-review-001",
          agent: "creative_review",
          title: "광고 중요사항 고지 확인 필요",
          issueType: "ai_creative_review",
          riskLevel: "high",
          targetText: "누구나 최고 연 5.0%",
          description: "중요한 제한 조건이 누락될 수 있습니다.",
          suggestedAction: "change_request",
          suggestedCopy: "제한 조건을 함께 표시해 주세요.",
          evidenceCandidateIds: ["knowledge-financial-ad-guideline-toc"],
          confidence: 0.9
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);
    const aiIssue = issues.find((candidate) => candidate.issueType === "ai_creative_review");

    expect(aiIssue?.evidence).toEqual([
      expect.objectContaining({
        chunkId: "chunk-financial-ad-guideline-8-3",
        quoteSummary: expect.stringContaining("제8조제3항")
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

  it("does not create unreadable-image issues when only image files are uploaded without OCR text", () => {
    const review: ReviewCase = {
      id: "rc-image-only-001",
      title: "이미지 단독 업로드 심의",
      affiliate: "광주은행",
      productType: "image_test",
      channelType: ["poster"],
      plannedPublishDate: "2026-06-20",
      status: "analysis_complete",
      highestRiskLevel: "info",
      requester: "업로드 요청자",
      reviewer: "준법심의자",
      promotionalCopy: "",
      disclosure: "",
      productDescription: "",
      missingMaterials: [],
      files: [
        {
          id: "file-image-only-001",
          name: "대출광고1.jpeg",
          fileType: "promotional_creative",
          classificationConfidence: 0.95,
          parseStatus: "pending",
          storageProvider: "local",
          storageKey: "local/rc-image-only-001/file-image-only-001/loan-ad.jpeg",
          contentType: "image/jpeg",
          sizeBytes: 1024
        }
      ],
      issues: [],
      expectedDraft: ""
    };
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-06-02T00:00:00.000Z",
      extractedDocuments: [],
      evidenceCandidates: []
    };

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueType: "ocr_required"
        })
      ])
    );
  });
});
