import type { ReviewCase } from "@/domain/types";
import type { ModelProvider } from "@/server/ai/model-provider";
import { runMultilingualRiskTeam } from "./multilingual-risk-team";
import type { MultilingualSegment } from "./multilingual";
import type { RagEvidenceCandidate } from "./review-analysis-pipeline";

const review: ReviewCase = {
  id: "rc-multilingual-001",
  title: "다국어 대출 광고",
  affiliate: "광주은행",
  productType: "loan",
  channelType: ["poster"],
  plannedPublishDate: "2026-06-20",
  status: "analysis_waiting",
  highestRiskLevel: "info",
  requester: "업로드 요청자",
  reviewer: "준법심의자",
  promotionalCopy: "Guaranteed approval in 3 minutes",
  disclosure: "심사 결과에 따라 달라질 수 있음",
  productDescription: "대출은 내부 심사 기준에 따라 승인됩니다.",
  missingMaterials: [],
  files: [],
  issues: [],
  expectedDraft: "검토 필요"
};

const evidenceCandidates: RagEvidenceCandidate[] = [
  {
    id: "ev-law-001",
    sourceType: "law",
    documentId: "law-001",
    title: "금융광고 심사 기준",
    quoteSummary: "대출 승인 확정 표현은 소비자를 오인시킬 수 있습니다.",
    relevanceScore: 0.91
  }
];

function segment(
  input: Partial<MultilingualSegment> &
    Pick<MultilingualSegment, "id" | "language" | "originalText">
): MultilingualSegment {
  return {
    normalizedText: input.originalText,
    confidence: 0.94,
    ...input
  };
}

function providerReturning(outputs: Record<string, string | Error>): ModelProvider & {
  calls: string[];
  inputs: Array<Parameters<ModelProvider["generateText"]>[0]>;
} {
  const calls: string[] = [];
  const inputs: Array<Parameters<ModelProvider["generateText"]>[0]> = [];

  return {
    calls,
    inputs,
    generateText: vi.fn(async (input) => {
      const { task } = input;
      calls.push(String(task));
      inputs.push(input);
      const output = outputs[String(task)] ?? "[]";

      if (output instanceof Error) {
        throw output;
      }

      return {
        provider: "deterministic",
        model: "fixture",
        text: output
      };
    })
  };
}

describe("runMultilingualRiskTeam", () => {
  it("calls only detected language agents and maps localized findings", async () => {
    const provider = providerReturning({
      english_translator_risk: JSON.stringify({
        findings: [
          {
            segmentId: "seg-en-001",
            language: "en",
            originalText: "model should not override this",
            literalTranslation: "3분 내 승인 보장",
            complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
            riskCategory: "both",
            riskSignals: ["guaranteed approval"],
            riskLevelHint: "high",
            suggestedCopyOriginalLanguage: "Approval may vary after review.",
            suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
            confidence: 0.88
          }
        ]
      }),
      korean_compliance_mapping: JSON.stringify({
        mappings: [
          {
            localizedFindingId: "seg-en-001",
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
            koreanComplianceCategory: "대출 승인 보장 표현",
            koreanComplianceReason: "심사 전 승인 확정 표현은 오인 가능성이 큽니다.",
            evidenceQuery: "대출 승인 보장 금융광고",
            suggestedAction: "reject"
          }
        ]
      })
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes"
        })
      ],
      evidenceCandidates,
      provider
    });

    expect(provider.calls).toEqual(["english_translator_risk", "korean_compliance_mapping"]);
    expect(
      provider.inputs.find((input) => input.task === "english_translator_risk")?.instructions
    ).toContain("Common Risk Policy");
    expect(
      provider.inputs.find((input) => input.task === "english_translator_risk")?.instructions
    ).toContain('Never output "reject_recommended"');
    expect(
      provider.inputs.find((input) => input.task === "korean_compliance_mapping")?.instructions
    ).toContain("FinProof korean_compliance_mapping agent");
    expect(
      provider.inputs.find((input) => input.task === "korean_compliance_mapping")?.instructions
    ).toContain("Return strict JSON only as an object with a `mappings` array");
    expect(result.localizedRiskFindings).toHaveLength(1);
    expect(result.koreanComplianceMappings).toHaveLength(1);
    expect(result.agentFindings[0]).toMatchObject({
      agent: "korean_compliance_mapping",
      issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
      targetText: "Guaranteed approval in 3 minutes",
      riskLevel: "high",
      suggestedAction: "change_request",
      suggestedCopy: "승인은 심사 후 달라질 수 있습니다."
    });
  });

  it("stores Korean-facing description and suggested copy for multilingual findings", async () => {
    const provider = providerReturning({
      english_translator_risk: JSON.stringify({
        findings: [
          {
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Representative rate: 4.10% p.a.",
            literalTranslation: "대표 금리 연 4.10%",
            complianceMeaning:
              "Displaying a low headline rate without immediate qualifications can mislead consumers.",
            riskCategory: "both",
            riskSignals: ["headline_rate"],
            riskLevelHint: "high",
            suggestedCopyOriginalLanguage:
              "Final rate depends on credit assessment and eligibility.",
            suggestedCopyKoreanMeaning:
              "최종 금리는 개인별 신용도와 우대조건 충족 여부에 따라 달라질 수 있습니다.",
            confidence: 0.9
          }
        ]
      }),
      korean_compliance_mapping: JSON.stringify({
        mappings: [
          {
            localizedFindingId: "seg-en-001",
            issueType: "MULTILINGUAL_RATE_CONDITION",
            koreanComplianceCategory: "최저금리 조건 고지",
            koreanComplianceReason:
              "최저금리 또는 대표금리 표현은 적용 조건을 인접하게 밝혀야 합니다.",
            evidenceQuery: "최저금리 조건 고지",
            suggestedAction: "change_request"
          }
        ]
      })
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Representative rate: 4.10% p.a."
        })
      ],
      evidenceCandidates,
      provider
    });

    expect(result.agentFindings[0]).toMatchObject({
      description: expect.stringContaining(
        "최저금리 또는 대표금리 표현은 적용 조건을 인접하게 밝혀야 합니다."
      ),
      suggestedCopy: "최종 금리는 개인별 신용도와 우대조건 충족 여부에 따라 달라질 수 있습니다."
    });
  });

  it("maps multiple localized risks on the same segment by finding id", async () => {
    const provider = providerReturning({
      english_translator_risk: JSON.stringify({
        findings: [
          {
            id: "risk-approval",
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval with the lowest rate",
            literalTranslation: "승인 보장",
            complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
            riskCategory: "both",
            riskSignals: ["approval guarantee"],
            riskLevelHint: "high",
            suggestedCopyOriginalLanguage: "Approval may vary after review.",
            suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
            confidence: 0.9
          },
          {
            id: "risk-rate",
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval with the lowest rate",
            literalTranslation: "최저 금리",
            complianceMeaning: "조건 없이 최저 금리가 적용되는 것처럼 표현합니다.",
            riskCategory: "both",
            riskSignals: ["lowest rate"],
            riskLevelHint: "caution",
            suggestedCopyOriginalLanguage: "Rate may vary by eligibility.",
            suggestedCopyKoreanMeaning: "금리는 조건에 따라 달라질 수 있습니다.",
            confidence: 0.87
          }
        ]
      }),
      korean_compliance_mapping: JSON.stringify({
        mappings: [
          {
            localizedFindingId: "risk-approval",
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
            koreanComplianceCategory: "승인 보장 표현",
            koreanComplianceReason: "승인 보장 표현은 심사 조건을 오인시킬 수 있습니다.",
            evidenceQuery: "approval guarantee",
            suggestedAction: "reject"
          },
          {
            localizedFindingId: "risk-rate",
            issueType: "MULTILINGUAL_RATE_CONDITION",
            koreanComplianceCategory: "최저 금리 조건 표현",
            koreanComplianceReason: "최저 금리 표현은 적용 조건을 함께 밝혀야 합니다.",
            evidenceQuery: "lowest rate",
            suggestedAction: "change_request"
          }
        ]
      })
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval with the lowest rate"
        })
      ],
      evidenceCandidates,
      provider
    });

    expect(result.agentFindings.map((finding) => finding.issueType)).toEqual([
      "MULTILINGUAL_APPROVAL_GUARANTEE",
      "MULTILINGUAL_RATE_CONDITION"
    ]);
    expect(
      result.agentFindings.map((finding) => finding.localizedRiskFinding?.riskSignals)
    ).toEqual([["approval guarantee"], ["lowest rate"]]);
    expect(result.agentFindings.map((finding) => finding.suggestedCopy)).toEqual([
      "승인은 심사 후 달라질 수 있습니다.",
      "금리는 조건에 따라 달라질 수 있습니다."
    ]);
  });

  it("does not map an ambiguous segment id when one segment has multiple localized risks", async () => {
    const provider = providerReturning({
      english_translator_risk: JSON.stringify({
        findings: [
          {
            id: "risk-approval",
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval with the lowest rate",
            literalTranslation: "승인 보장",
            complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
            riskCategory: "both",
            riskSignals: ["approval guarantee"],
            riskLevelHint: "high",
            suggestedCopyOriginalLanguage: "Approval may vary after review.",
            suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
            confidence: 0.9
          },
          {
            id: "risk-rate",
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval with the lowest rate",
            literalTranslation: "최저 금리",
            complianceMeaning: "조건 없이 최저 금리가 적용되는 것처럼 표현합니다.",
            riskCategory: "both",
            riskSignals: ["lowest rate"],
            riskLevelHint: "caution",
            suggestedCopyOriginalLanguage: "Rate may vary by eligibility.",
            suggestedCopyKoreanMeaning: "금리는 조건에 따라 달라질 수 있습니다.",
            confidence: 0.87
          }
        ]
      }),
      korean_compliance_mapping: JSON.stringify({
        mappings: [
          {
            localizedFindingId: "seg-en-001",
            issueType: "MULTILINGUAL_AMBIGUOUS",
            koreanComplianceCategory: "모호한 다국어 매핑",
            koreanComplianceReason: "세그먼트 ID만으로는 리스크를 특정할 수 없습니다.",
            evidenceQuery: "ambiguous",
            suggestedAction: "hold"
          }
        ]
      })
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval with the lowest rate"
        })
      ],
      evidenceCandidates,
      provider
    });

    expect(result.koreanComplianceMappings).toEqual([]);
    expect(result.agentFindings).toEqual([]);
  });

  it("drops localized findings without non-empty risk signals before mapping", async () => {
    const provider = providerReturning({
      english_translator_risk: JSON.stringify({
        findings: [
          {
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval in 3 minutes",
            literalTranslation: "3분 내 승인 보장",
            complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
            riskCategory: "both",
            riskSignals: ["   "],
            riskLevelHint: "high",
            suggestedCopyOriginalLanguage: "Approval may vary after review.",
            suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
            confidence: 0.88
          }
        ]
      }),
      korean_compliance_mapping: JSON.stringify({
        mappings: [
          {
            localizedFindingId: "seg-en-001",
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
            koreanComplianceCategory: "대출 승인 보장 표현",
            koreanComplianceReason: "심사 전 승인 확정 표현은 오인 가능성이 큽니다.",
            evidenceQuery: "대출 승인 보장 금융광고",
            suggestedAction: "reject"
          }
        ]
      })
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes"
        })
      ],
      evidenceCandidates,
      provider
    });

    expect(provider.calls).toEqual(["english_translator_risk"]);
    expect(result.localizedRiskFindings).toEqual([]);
    expect(result.agentFindings).toEqual([]);
  });

  it("continues when one language agent fails", async () => {
    const provider = providerReturning({
      myanmar_translator_risk: new Error("model timeout"),
      khmer_translator_risk: JSON.stringify({ findings: [] })
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-my-001",
          language: "my",
          originalText: "ချေးငွေ အတည်ပြုချက် ၃ မိနစ်အတွင်း"
        }),
        segment({
          id: "seg-km-001",
          language: "km",
          originalText: "អនុម័តប្រាក់កម្ចីក្នុង ៣ នាទី"
        })
      ],
      evidenceCandidates,
      provider
    });

    expect(result.errors).toEqual([
      {
        agentType: "myanmar_translator_risk",
        language: "my",
        message: "model timeout"
      }
    ]);
    expect(provider.calls).toEqual(["myanmar_translator_risk", "khmer_translator_risk"]);
  });

  it("turns low confidence localized risk into a caution review-needed finding", async () => {
    const provider = providerReturning({
      english_translator_risk: JSON.stringify([
        {
          segmentId: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes",
          literalTranslation: "3분 내 승인 보장",
          complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
          riskCategory: "both",
          riskSignals: ["guaranteed approval"],
          riskLevelHint: "reject_recommended",
          suggestedCopyOriginalLanguage: "Approval may vary after review.",
          suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
          confidence: 0.58
        }
      ]),
      korean_compliance_mapping: JSON.stringify([
        {
          localizedFindingId: "seg-en-001",
          issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
          koreanComplianceCategory: "대출 승인 보장 표현",
          koreanComplianceReason: "심사 전 승인 확정 표현은 오인 가능성이 큽니다.",
          evidenceQuery: "대출 승인 보장 금융광고",
          suggestedAction: "hold"
        }
      ])
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes"
        })
      ],
      evidenceCandidates,
      provider
    });

    expect(result.agentFindings[0]).toMatchObject({
      riskLevel: "caution",
      title: "원문 검토 필요",
      suggestedAction: "hold"
    });
  });

  it("omits evidence ids when candidates are below relevance threshold", async () => {
    const provider = providerReturning({
      english_translator_risk: JSON.stringify([
        {
          segmentId: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes",
          literalTranslation: "3분 내 승인 보장",
          complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
          riskCategory: "both",
          riskSignals: ["guaranteed approval"],
          riskLevelHint: "high",
          suggestedCopyOriginalLanguage: "Approval may vary after review.",
          suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
          confidence: 0.88
        }
      ]),
      korean_compliance_mapping: JSON.stringify([
        {
          localizedFindingId: "seg-en-001",
          issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
          koreanComplianceCategory: "대출 승인 보장 표현",
          koreanComplianceReason: "심사 전 승인 확정 표현은 오인 가능성이 큽니다.",
          evidenceQuery: "대출 승인 보장 금융광고",
          suggestedAction: "reject"
        }
      ])
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes"
        })
      ],
      evidenceCandidates: [
        {
          id: "ev-low-001",
          sourceType: "law",
          title: "낮은 관련도 근거",
          quoteSummary: "직접 관련성이 낮은 근거입니다.",
          relevanceScore: 0.71
        },
        {
          id: "ev-low-002",
          sourceType: "internal_policy",
          title: "낮은 관련도 내부 기준",
          quoteSummary: "직접 관련성이 낮은 내부 기준입니다.",
          relevanceScore: 0.42
        }
      ],
      provider
    });

    expect(result.agentFindings[0]?.evidenceCandidateIds).toEqual([]);
    expect(result.agentFindings[0]?.description).toContain("불충분 근거");
  });

  it("selects matching evidence for each mapped finding without unrelated high relevance evidence", async () => {
    const provider = providerReturning({
      english_translator_risk: JSON.stringify([
        {
          segmentId: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes",
          literalTranslation: "alphaapproval 승인 보장",
          complianceMeaning: "alphaapproval 대출 승인 보장 표현입니다.",
          riskCategory: "both",
          riskSignals: ["alphaapproval", "guaranteed approval"],
          riskLevelHint: "high",
          suggestedCopyOriginalLanguage: "Approval may vary after review.",
          suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
          confidence: 0.9
        },
        {
          segmentId: "seg-en-002",
          language: "en",
          originalText: "Lowest rate for everyone",
          literalTranslation: "betarate 모두에게 최저 금리",
          complianceMeaning: "betarate 우대 조건 없는 최저 금리 표현입니다.",
          riskCategory: "both",
          riskSignals: ["betarate", "lowest rate"],
          riskLevelHint: "caution",
          suggestedCopyOriginalLanguage: "Lowest rate may require eligibility conditions.",
          suggestedCopyKoreanMeaning: "최저 금리는 조건 충족 시 적용됩니다.",
          confidence: 0.86
        }
      ]),
      korean_compliance_mapping: JSON.stringify([
        {
          localizedFindingId: "seg-en-001",
          issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
          koreanComplianceCategory: "alphaapproval 승인 보장 표현",
          koreanComplianceReason: "alphaapproval 심사 전 승인 확정 표현은 오인 가능성이 큽니다.",
          evidenceQuery: "alphaapproval 대출 승인 보장",
          suggestedAction: "reject"
        },
        {
          localizedFindingId: "seg-en-002",
          issueType: "MULTILINGUAL_RATE_CONDITION",
          koreanComplianceCategory: "betarate 금리 조건 표현",
          koreanComplianceReason:
            "betarate 우대 조건 없는 최저 금리 표현은 조건 누락 위험이 있습니다.",
          evidenceQuery: "betarate 최저 금리 우대 조건",
          suggestedAction: "change_request"
        }
      ])
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes"
        }),
        segment({
          id: "seg-en-002",
          language: "en",
          originalText: "Lowest rate for everyone"
        })
      ],
      evidenceCandidates: [
        {
          id: "ev-unrelated-high",
          sourceType: "law",
          title: "gammaunrelated 예금 중도해지 기준",
          quoteSummary: "gammaunrelated 만기 전 해지와 이자 산정 기준입니다.",
          relevanceScore: 0.99
        },
        {
          id: "ev-approval",
          sourceType: "law",
          title: "alphaapproval 대출 승인 보장 광고 기준",
          quoteSummary: "alphaapproval 심사 전 대출 승인 보장 표현은 제한됩니다.",
          relevanceScore: 0.91
        },
        {
          id: "ev-rate",
          sourceType: "internal_policy",
          title: "betarate 최저 금리 우대 조건 고지",
          quoteSummary: "betarate 최저 금리는 우대 조건과 한도를 함께 고지해야 합니다.",
          relevanceScore: 0.89
        }
      ],
      provider
    });

    expect(result.agentFindings.map((finding) => finding.evidenceCandidateIds)).toEqual([
      ["ev-approval"],
      ["ev-rate"]
    ]);
  });

  it("returns localized findings and mapping error when Korean mapping agent fails", async () => {
    const provider = providerReturning({
      english_translator_risk: JSON.stringify([
        {
          segmentId: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes",
          literalTranslation: "3분 내 승인 보장",
          complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
          riskCategory: "both",
          riskSignals: ["guaranteed approval"],
          riskLevelHint: "high",
          suggestedCopyOriginalLanguage: "Approval may vary after review.",
          suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
          confidence: 0.88
        }
      ]),
      korean_compliance_mapping: new Error("mapping unavailable")
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes"
        })
      ],
      evidenceCandidates,
      provider
    });

    expect(result.localizedRiskFindings).toHaveLength(1);
    expect(result.koreanComplianceMappings).toEqual([]);
    expect(result.agentFindings).toEqual([]);
    expect(result.errors).toEqual([
      {
        agentType: "korean_compliance_mapping",
        message: "mapping unavailable"
      }
    ]);
  });

  it("treats malformed JSON fragments as empty agent output", async () => {
    const provider = providerReturning({
      english_translator_risk: '[{"segmentId":"seg-en-001","confidence":0.}]'
    });

    const result = await runMultilingualRiskTeam({
      review,
      segments: [
        segment({
          id: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes"
        })
      ],
      evidenceCandidates,
      provider
    });

    expect(result.localizedRiskFindings).toEqual([]);
    expect(result.koreanComplianceMappings).toEqual([]);
    expect(result.agentFindings).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
