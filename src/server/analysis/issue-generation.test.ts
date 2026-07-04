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

  it("carries semanticPreservation and mqm from localizedRiskFinding to multilingualContext", () => {
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
          id: "finding-multilingual-002",
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
            confidence: 0.91,
            semanticPreservation: {
              semanticRelation: "stronger",
              semanticShiftScore: 0.8,
              missingConditionTerms: [],
              overclaimTerms: ["guaranteed"],
              nliProbabilities: { entailment: 0.2, neutral: 0.5, contradiction: 0.3 },
              model: "mDeBERTa-v3-base-mnli-xnli"
            },
            mqm: {
              errorType: "addition",
              complianceRiskType: "approval_guarantee",
              severity: "major",
              targetSpan: "Guaranteed approval",
              evidenceType: "product_doc",
              recommendedAction: "change_request"
            }
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
    expect(issues[0].multilingualContext?.semanticPreservation).toEqual({
      semanticRelation: "stronger",
      semanticShiftScore: 0.8,
      missingConditionTerms: [],
      overclaimTerms: ["guaranteed"],
      nliProbabilities: { entailment: 0.2, neutral: 0.5, contradiction: 0.3 },
      model: "mDeBERTa-v3-base-mnli-xnli"
    });
    expect(issues[0].multilingualContext?.mqm).toEqual({
      errorType: "addition",
      complianceRiskType: "approval_guarantee",
      severity: "major",
      targetSpan: "Guaranteed approval",
      evidenceType: "product_doc",
      recommendedAction: "change_request"
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

  it("turns social context risk findings into review issues with the social agent source", () => {
    const review = getReviewCaseById("rc-demo-deposit-001")!;
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-07-02T00:00:00.000Z",
      extractedDocuments: [
        {
          fileId: "file-upload-001",
          fileName: "poster.txt",
          text: "탱크데이 혜택 폭격 이벤트",
          confidence: 0.95,
          provider: "fixture"
        }
      ],
      evidenceCandidates: [
        {
          id: "ev-social-symbol",
          sourceType: "internal_policy",
          title: "02_상징_이미지_체크리스트.md",
          quoteSummary:
            "무기, 폭발, 군사적 상징은 캠페인 맥락에 따라 사회적 논란 가능성을 확인한다.",
          relevanceScore: 0.91
        }
      ],
      agentFindings: [
        {
          id: "finding-social-context-001",
          agent: "social_context_risk",
          title: "군사적 상징 연상 가능성",
          issueType: "SOCIAL_CONTEXT_SYMBOL_DATE",
          riskLevel: "caution",
          targetText: "탱크데이 혜택 폭격",
          description: "캠페인명과 문구가 군사적 상징을 연상시킬 수 있어 PR 확인이 필요합니다.",
          suggestedAction: "hold",
          suggestedCopy: "캠페인명과 혜택 문구를 중립적 표현으로 조정해 주세요.",
          evidenceCandidateIds: ["ev-social-symbol"],
          confidence: 0.82
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueType: "SOCIAL_CONTEXT_SYMBOL_DATE",
          title: "군사적 상징 연상 가능성",
          sourceAgents: ["social_context_risk"],
          suggestedAction: "hold",
          evidence: [
            expect.objectContaining({
              title: "02_상징_이미지_체크리스트.md"
            })
          ]
        })
      ])
    );
  });

  it("keeps social-context findings grounded in social-context evidence instead of generic policy", () => {
    const review = { ...getReviewCaseById("rc-demo-deposit-001")!, missingMaterials: [] };
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-07-03T00:00:00.000Z",
      extractedDocuments: [
        {
          fileId: "file-upload-001",
          fileName: "tank-day-poster.txt",
          text: "탱크데이 혜택 폭격 이벤트",
          confidence: 0.95,
          provider: "fixture"
        }
      ],
      evidenceCandidates: [
        {
          id: "ev-uploaded-poster",
          sourceType: "product_doc",
          title: "tank-day-poster.txt",
          quoteSummary: "탱크데이 혜택 폭격 이벤트",
          relevanceScore: 0.95,
          sourceFileId: "file-upload-001"
        },
        {
          id: "ev-generic-card-policy",
          sourceType: "internal_policy",
          title: "금융위·금감원 금융상품 광고 규제 가이드",
          quoteSummary: "금융상품 광고는 소비자가 조건을 오인하지 않도록 표시해야 한다.",
          relevanceScore: 0.94
        },
        {
          id: "ev-social-campaign-name",
          sourceType: "internal_policy",
          title: "03_문구_캠페인명_체크리스트.md",
          quoteSummary: "군사적, 공격적 표현은 캠페인명과 문구의 사회맥락을 확인하고 완화한다.",
          relevanceScore: 0.2
        }
      ],
      agentFindings: [
        {
          id: "finding-social-context-002",
          agent: "social_context_risk",
          title: "군사·폭력 은유 표현의 사회적 논란 가능성",
          issueType: "SOCIAL_CONTEXT_CAMPAIGN_COPY",
          riskLevel: "caution",
          targetText: "탱크데이 혜택 폭격",
          description: "캠페인명과 홍보 문구가 군사적·공격적 표현으로 해석될 수 있습니다.",
          suggestedAction: "hold",
          suggestedCopy: "캠페인명과 혜택 문구를 중립적 표현으로 조정해 주세요.",
          evidenceCandidateIds: ["ev-generic-card-policy"],
          confidence: 0.82
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues).toHaveLength(1);
    expect(issues[0].evidence).toEqual([
      expect.objectContaining({ sourceType: "product_doc", title: "tank-day-poster.txt" }),
      expect.objectContaining({ title: "03_문구_캠페인명_체크리스트.md" })
    ]);
    expect(issues[0].evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "금융위·금감원 금융상품 광고 규제 가이드" })
      ])
    );
  });

  it("drops social-context findings when no social-context evidence is available", () => {
    const review = { ...getReviewCaseById("rc-demo-deposit-001")!, missingMaterials: [] };
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-07-03T00:00:00.000Z",
      extractedDocuments: [
        {
          fileId: "file-upload-001",
          fileName: "deposit-poster.txt",
          text: "매일더함 자유적금 안내",
          confidence: 0.95,
          provider: "fixture"
        }
      ],
      evidenceCandidates: [
        {
          id: "ev-generic-deposit-policy",
          sourceType: "internal_policy",
          title: "예금·적금 광고 심의 체크리스트",
          quoteSummary:
            "최고 금리 표기 시 우대조건과 기본금리를 병기해 소비자 정서와 사회적 논란 가능성을 줄여야 한다.",
          relevanceScore: 0.92
        }
      ],
      agentFindings: [
        {
          id: "finding-social-context-003",
          agent: "social_context_risk",
          title: "게시 예정일의 사회적 민감성 추가 확인 필요",
          issueType: "SOCIAL_CONTEXT_SENSITIVE_DATE",
          riskLevel: "caution",
          targetText: "게시 예정일: 2026-04-16",
          description: "민감일 근접 여부를 확인해야 합니다.",
          suggestedAction: "hold",
          suggestedCopy: "게시일을 민감일과 겹치지 않도록 점검해 주세요.",
          evidenceCandidateIds: ["ev-generic-deposit-policy"],
          confidence: 0.75
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues).toEqual([]);
  });

  it("attaches the most issue-relevant regulation to each issue, not the globally top one", () => {
    const review = getReviewCaseById("rc-demo-deposit-001")!;
    const rateRule = {
      id: "ev-rate",
      sourceType: "internal_policy" as const,
      title: "금리 표시 의무 규정",
      quoteSummary: "광고에 금리를 표시할 때 기본금리와 최고금리, 적용 조건을 함께 표시해야 한다.",
      relevanceScore: 0.55
    };
    const disclosureRule = {
      id: "ev-disclosure",
      sourceType: "internal_policy" as const,
      title: "필수 고지 가독성 규정",
      quoteSummary: "필수 고지 사항은 소비자가 읽을 수 있는 크기와 가독성으로 표시해야 한다.",
      relevanceScore: 0.62 // globally higher → old code attached this to BOTH issues
    };
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-07-01T00:00:00.000Z",
      extractedDocuments: [
        {
          fileId: "f",
          fileName: "ad.txt",
          text: "적금 안내문",
          confidence: 0.9,
          provider: "fixture"
        }
      ],
      // disclosure listed first AND higher score: without per-issue selection it wins both.
      evidenceCandidates: [disclosureRule, rateRule],
      agentFindings: [
        {
          id: "rate",
          agent: "creative_review",
          issueType: "rate_claim",
          riskLevel: "high",
          title: "최고금리 표시 조건 확인 필요",
          targetText: "최고 연 4.5%",
          description: "최고금리 표시 시 기본금리·적용 조건 병기가 불충분합니다.",
          suggestedAction: "change_request",
          suggestedCopy: "최고금리 적용 조건을 함께 표시해 주세요.",
          evidenceCandidateIds: ["ev-rate", "ev-disclosure"],
          confidence: 0.8
        },
        {
          id: "disclosure",
          agent: "creative_review",
          issueType: "disclosure",
          riskLevel: "caution",
          title: "필수 고지 가독성 확인 필요",
          targetText: "하단 고지 문구",
          description: "필수 고지 사항의 가독성 보완이 필요합니다.",
          suggestedAction: "hold",
          suggestedCopy: "필수 고지를 읽을 수 있는 크기로 표시해 주세요.",
          evidenceCandidateIds: ["ev-rate", "ev-disclosure"],
          confidence: 0.8
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);
    const rateIssue = issues.find((issue) => issue.id === `issue-${review.id}-rate`)!;
    const disclosureIssue = issues.find((issue) => issue.id === `issue-${review.id}-disclosure`)!;

    // Each issue gets the regulation most relevant to IT — even though the disclosure
    // rule has the higher global score and would have been attached to both before.
    expect(rateIssue.evidence[0].title).toBe("금리 표시 의무 규정");
    expect(disclosureIssue.evidence[0].title).toBe("필수 고지 가독성 규정");
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

  it("attaches registered knowledge evidence the reranker under-scored (below the product-doc floor)", () => {
    // Cohere systematically under-scores Korean regulation text; an on-point checklist can
    // land at ~0.2 (below MIN_MATCHED_EVIDENCE_SCORE=0.5) yet still be the correct basis.
    // Knowledge-corpus evidence uses the lower KNOWLEDGE_MATCHED_EVIDENCE_SCORE floor so it
    // attaches instead of falling back to the product doc.
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
          id: "knowledge-underscored-checklist",
          sourceType: "internal_policy",
          documentId: "knowledge-underscored-checklist",
          chunkId: "chunk-underscored-checklist-001",
          title: "대출 광고 심의 체크리스트",
          quoteSummary: "확정적 승인·즉시 승인 등 오인 유발 표현을 사용하지 않아야 한다.",
          relevanceScore: 0.2
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
          evidenceCandidateIds: ["knowledge-underscored-checklist"],
          confidence: 0.86
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues[0].evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: "knowledge-underscored-checklist",
          sourceType: "internal_policy"
        })
      ])
    );
  });

  it("keeps the standard floor for non-knowledge candidates (case_history stays excluded below 0.5)", () => {
    // Only registered knowledge (law/internal_policy) gets the lower floor. A case_history
    // candidate at 0.2 must stay below MIN_MATCHED_EVIDENCE_SCORE and NOT attach.
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
          id: "case-underscored",
          sourceType: "case_history",
          documentId: "case-underscored",
          chunkId: "chunk-case-underscored-001",
          title: "유사 심의 사례",
          quoteSummary: "즉시 승인 표현 관련 과거 심의 사례.",
          relevanceScore: 0.2
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
          evidenceCandidateIds: ["case-underscored"],
          confidence: 0.86
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues[0].evidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceType: "case_history" })])
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
      expectedDraft: "",
      currentVersion: 1
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
      expectedDraft: "",
      currentVersion: 1
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

  it("suppresses missing-origin agent findings when all required upload materials are present", () => {
    const review: ReviewCase = {
      id: "rc-complete-upload-001",
      title: "CoVe",
      affiliate: "FinProof Bank",
      productType: "deposit",
      channelType: ["mobile_app", "website"],
      plannedPublishDate: "2026-04-16",
      status: "analysis_complete",
      highestRiskLevel: "info",
      requester: "마케팅",
      reviewer: "준법감시",
      promotionalCopy: "",
      disclosure: "",
      productDescription: "",
      missingMaterials: ["copy_draft"],
      files: [
        {
          id: "file-creative",
          name: "finproof_bank_.zip/finproof_bank/poster_finproof_daily_savings.png",
          fileType: "promotional_creative",
          classificationConfidence: 0.87,
          parseStatus: "parsed",
          storageProvider: "local",
          storageKey: "local/rc-complete-upload-001/file-creative/poster.png",
          contentType: "image/png",
          sizeBytes: 1_600_000
        },
        {
          id: "file-copy",
          name: "finproof_bank_.zip/finproof_bank/copy_draft_daily_savings.txt",
          fileType: "copy_draft",
          classificationConfidence: 0.85,
          parseStatus: "parsed",
          storageProvider: "local",
          storageKey: "local/rc-complete-upload-001/file-copy/copy.txt",
          contentType: "text/plain",
          sizeBytes: 1024
        },
        {
          id: "file-product",
          name: "finproof_bank_.zip/finproof_bank/product_description_daily_savings.txt",
          fileType: "product_description",
          classificationConfidence: 0.85,
          parseStatus: "parsed",
          storageProvider: "local",
          storageKey: "local/rc-complete-upload-001/file-product/product.txt",
          contentType: "text/plain",
          sizeBytes: 1024
        },
        {
          id: "file-rate",
          name: "finproof_bank_.zip/finproof_bank/rate_table_daily_savings.csv",
          fileType: "rate_table",
          classificationConfidence: 0.91,
          parseStatus: "parsed",
          storageProvider: "local",
          storageKey: "local/rc-complete-upload-001/file-rate/rate.csv",
          contentType: "text/csv",
          sizeBytes: 1024
        },
        {
          id: "file-checklist",
          name: "finproof_bank_.zip/finproof_bank/internal_checklist_daily_savings.txt",
          fileType: "checklist",
          classificationConfidence: 0.91,
          parseStatus: "parsed",
          storageProvider: "local",
          storageKey: "local/rc-complete-upload-001/file-checklist/checklist.txt",
          contentType: "text/plain",
          sizeBytes: 1024
        }
      ],
      issues: [],
      expectedDraft: "",
      currentVersion: 1
    };
    const artifacts: AnalysisArtifacts = {
      generatedAt: "2026-07-04T00:00:00.000Z",
      extractedDocuments: [
        {
          fileId: "file-copy",
          fileName: "copy_draft_daily_savings.txt",
          text: "매일더함 자유적금 최고 연 4.50%. 우대조건 충족 시 적용됩니다.",
          confidence: 0.96,
          provider: "local-text-extractor"
        }
      ],
      evidenceCandidates: [
        {
          id: "ev-uploaded-copy",
          sourceType: "product_doc",
          title: "copy_draft_daily_savings.txt",
          quoteSummary: "매일더함 자유적금 최고 연 4.50%. 우대조건 충족 시 적용됩니다.",
          relevanceScore: 0.94,
          sourceFileId: "file-copy"
        }
      ],
      agentFindings: [
        {
          id: "finding-main-missing-origin",
          agent: "main",
          issueType: "missing_material",
          riskLevel: "caution",
          title: "광고 원문 미제출로 실질 심의 불가",
          targetText: "심의 요청 제목: CoVe / 상품군: deposit / 게시 채널: mobile_app, website",
          description:
            "실제 광고 이미지, 배너, 영상, 문구 등 광고 소재 원문이 첨부되지 않았습니다.",
          suggestedAction: "hold",
          suggestedCopy: "광고 소재 원문을 추가 제출해 주세요.",
          evidenceCandidateIds: ["ev-uploaded-copy"],
          confidence: 0.83
        },
        {
          id: "finding-main-missing-creative",
          agent: "main",
          issueType: "missing_creative",
          riskLevel: "caution",
          title: "광고 소재 미첨부로 핵심 심의 항목 확인 불가",
          targetText: "업로드 자료",
          description: "광고 소재가 첨부되지 않아 핵심 심의 항목 확인이 어렵습니다.",
          suggestedAction: "hold",
          suggestedCopy: "광고 소재를 추가 제출해 주세요.",
          evidenceCandidateIds: ["ev-uploaded-copy"],
          confidence: 0.83
        },
        {
          id: "finding-main-missing-original",
          agent: "main",
          issueType: "missing_original",
          riskLevel: "caution",
          title: "광고 원본 미첨부로 실질 심의 불가",
          targetText: "업로드 자료",
          description: "광고 원본이 첨부되지 않아 심의가 어렵습니다.",
          suggestedAction: "hold",
          suggestedCopy: "광고 원본을 추가 제출해 주세요.",
          evidenceCandidateIds: ["ev-uploaded-copy"],
          confidence: 0.83
        },
        {
          id: "finding-main-missing-content",
          agent: "main",
          issueType: "missing_content",
          riskLevel: "caution",
          title: "광고 원문 미첨부로 실질적 심의 진행 불가",
          targetText: "심의 요청 메타데이터",
          description: "실제 포스터 광고 원문이 첨부되지 않았다고 판단했습니다.",
          suggestedAction: "hold",
          suggestedCopy: "광고 원문을 추가 제출해 주세요.",
          evidenceCandidateIds: ["ev-uploaded-copy"],
          confidence: 0.83
        },
        {
          id: "finding-main-premature-guide",
          agent: "main",
          issueType: "regulatory_notice",
          riskLevel: "info",
          title: "예금·적금 상품 광고 필수 심의 항목 사전 안내",
          targetText: "광고 원문",
          description: "광고 원문이 제출된 이후 우선적으로 점검해야 할 항목을 사전 안내합니다.",
          suggestedAction: "hold",
          suggestedCopy: "광고 원문 제출 후 다시 점검해 주세요.",
          evidenceCandidateIds: ["ev-uploaded-copy"],
          confidence: 0.83
        }
      ]
    };

    const issues = buildAnalysisIssues(review, artifacts);

    expect(issues).toEqual([]);
  });

  it("keeps stored missing-material issues when required upload materials are still absent", () => {
    const review: ReviewCase = {
      id: "rc-incomplete-upload-001",
      title: "원문 누락 테스트",
      affiliate: "FinProof Bank",
      productType: "deposit",
      channelType: ["website"],
      plannedPublishDate: "2026-04-16",
      status: "analysis_complete",
      highestRiskLevel: "info",
      requester: "마케팅",
      reviewer: "준법감시",
      promotionalCopy: "",
      disclosure: "",
      productDescription: "",
      missingMaterials: ["copy_draft"],
      files: [
        {
          id: "file-creative",
          name: "poster.png",
          fileType: "promotional_creative",
          classificationConfidence: 0.87,
          parseStatus: "parsed",
          storageProvider: "local",
          storageKey: "local/rc-incomplete-upload-001/file-creative/poster.png",
          contentType: "image/png",
          sizeBytes: 1024
        }
      ],
      issues: [],
      expectedDraft: "",
      currentVersion: 1
    };

    const issues = buildAnalysisIssues(review, {
      generatedAt: "2026-07-04T00:00:00.000Z",
      extractedDocuments: [],
      evidenceCandidates: []
    });

    expect(issues).toEqual([
      expect.objectContaining({
        issueType: "missing_material",
        title: "필수 심의 자료 누락",
        targetText: "copy_draft"
      })
    ]);
  });
});
