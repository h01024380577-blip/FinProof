import type { ReviewCase } from "@/domain/types";
import type { ModelProvider } from "@/server/ai/model-provider";
import type { AgentFinding } from "./review-subagents";
import {
  createReviewSubAgentOrchestrator,
  dedupeConsolidatedSocialContextFindings,
  finalOrchestratedFindings,
  sanitizeReviewerText
} from "./review-subagents";
import type { ExtractedDocument, RagEvidenceCandidate } from "./review-analysis-pipeline";

const review: ReviewCase = {
  id: "rc-upload-007",
  title: "시연용 대출광고 심의 테스트",
  affiliate: "전북은행",
  productType: "loan",
  channelType: ["mobile_banner"],
  plannedPublishDate: "2026-06-20",
  status: "analysis_waiting",
  highestRiskLevel: "info",
  requester: "업로드 요청자",
  reviewer: "준법심의자",
  promotionalCopy: "누구나 빠르게 승인 가능한 최저금리 신용대출",
  disclosure: "심사 결과에 따라 달라질 수 있음",
  productDescription: "대출은 내부 심사 기준에 따라 승인됩니다.",
  missingMaterials: [],
  files: [],
  issues: [],
  expectedDraft: "검토 필요",
  currentVersion: 1
};

const extractedDocuments: ExtractedDocument[] = [
  {
    fileId: "file-copy",
    fileName: "02_원문카피_전체문안.txt",
    text: "누구나 빠르게 승인 가능한 최저금리 신용대출 최저 연 4.9%",
    confidence: 0.96,
    provider: "stored-text"
  }
];

const evidenceCandidates: RagEvidenceCandidate[] = [
  {
    id: "evidence-rate-rule",
    sourceType: "internal_policy",
    documentId: "knowledge-jeonbuk-loan-ad-policy-demo-202606",
    title: "전북은행 대출광고 심의 운영지침",
    quoteSummary: "최저금리는 금리표 기준과 일치해야 하며 조건을 함께 표시해야 한다.",
    relevanceScore: 0.91
  }
];

function providerReturning(outputs: Record<string, string>): ModelProvider {
  return {
    generateText: vi.fn(async (input) => ({
      provider: "deterministic",
      model: "fixture",
      text: outputs[String(input.task)] ?? "[]"
    }))
  };
}

describe("createReviewSubAgentOrchestrator", () => {
  it("continues when one agent returns a malformed JSON fragment", async () => {
    const provider = providerReturning({
      creative_review: JSON.stringify({
        findings: [
          {
            title: "절대적 승인 표현 점검",
            issueType: "absolute_claim",
            riskLevel: "info",
            targetText: "누구나 빠르게 승인",
            description: "승인 표현의 조건 고지 여부를 확인합니다.",
            suggestedAction: "hold",
            suggestedCopy: "심사 결과에 따라 달라질 수 있습니다.",
            evidenceCandidateIds: ["evidence-rate-rule"],
            confidence: 0.92
          }
        ]
      }),
      regulation_agent: '[{"title":"깨진 JSON","confidence":0.}]',
      main_compliance: JSON.stringify({
        findings: [
          {
            title: "최저금리 조건 고지 필요",
            issueType: "rate_claim",
            riskLevel: "high",
            targetText: "최저 연 4.9%",
            description: "최저금리 산출 조건과 금리표 일치 여부 확인이 필요합니다.",
            suggestedAction: "change_request",
            suggestedCopy: "적용금리는 심사 기준과 우대조건에 따라 달라질 수 있습니다.",
            evidenceCandidateIds: ["evidence-rate-rule"],
            confidence: 0.88
          }
        ]
      })
    });

    await expect(
      createReviewSubAgentOrchestrator(provider).run({
        review,
        extractedDocuments,
        evidenceCandidates
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "최저금리 조건 고지 필요",
          riskLevel: "high"
        })
      ])
    );
  });

  it("strips internal orchestration jargon leaked into reviewer-facing fields", async () => {
    const provider = providerReturning({
      creative_review: JSON.stringify({
        findings: [
          {
            title: "금리 조건 고지 점검",
            issueType: "rate_claim",
            riskLevel: "caution",
            targetText: "연5.5%",
            description: "금리 조건 고지 여부를 확인합니다.",
            suggestedAction: "hold",
            suggestedCopy: "적용 조건을 함께 표시해 주세요.",
            evidenceCandidateIds: ["evidence-rate-rule"],
            confidence: 0.7
          }
        ]
      }),
      main_compliance: JSON.stringify({
        findings: [
          {
            title: "제출 증거와 prior finding 근거의 불일치",
            issueType: "evidence_verification_gap",
            riskLevel: "caution",
            targetText: "연5.5% 한도 소진 시 조기 종료",
            description:
              "현재 증거만으로는 prior findings가 제기한 금리 조건을 뒷받침하기 어렵습니다.",
            suggestedAction: "hold",
            suggestedCopy: "기존 finding 설명을 증거가 커버하는 범위로 축소해 검토하세요.",
            evidenceCandidateIds: ["evidence-rate-rule"],
            confidence: 0.7
          }
        ]
      })
    });

    const result = await createReviewSubAgentOrchestrator(provider).run({
      review,
      extractedDocuments,
      evidenceCandidates
    });

    const combined = result
      .map((finding) => `${finding.title} ${finding.description} ${finding.suggestedCopy}`)
      .join(" ");

    expect(combined).not.toMatch(/prior\s*finding/i);
    expect(combined).not.toMatch(/\bfindings?\b/i);
    expect(result[0]?.title).toBe("제출 증거와 기존 지적 사항 근거의 불일치");
  });

  it("prioritizes and requires social-context evidence for social context findings", async () => {
    const socialEvidenceCandidates: RagEvidenceCandidate[] = [
      {
        id: "ev-generic-card-policy",
        sourceType: "internal_policy",
        title: "금융위·금감원 금융상품 광고 규제 가이드",
        quoteSummary: "금융상품 광고는 소비자가 조건을 오인하지 않도록 표시해야 한다.",
        relevanceScore: 0.94
      },
      {
        id: "ev-uploaded-poster",
        sourceType: "product_doc",
        title: "tank-day-poster.txt",
        quoteSummary: "탱크데이 혜택 폭격 이벤트",
        relevanceScore: 0.95
      },
      {
        id: "ev-social-campaign-name",
        sourceType: "internal_policy",
        title: "03_문구_캠페인명_체크리스트.md",
        quoteSummary: "군사적, 공격적 표현은 캠페인명과 문구의 사회맥락을 확인한다.",
        relevanceScore: 0.2
      }
    ];
    const provider = providerReturning({
      social_context_risk: JSON.stringify({
        findings: [
          {
            title: "군사·폭력 은유 표현의 사회적 논란 가능성",
            issueType: "SOCIAL_CONTEXT_CAMPAIGN_COPY",
            riskLevel: "caution",
            targetText: "탱크데이 혜택 폭격",
            description: "캠페인명과 홍보 문구가 공격적 표현으로 해석될 수 있습니다.",
            suggestedAction: "hold",
            suggestedCopy: "캠페인명과 혜택 문구를 중립적 표현으로 조정해 주세요.",
            evidenceCandidateIds: ["ev-generic-card-policy"],
            confidence: 0.82
          }
        ]
      })
    });

    const result = await createReviewSubAgentOrchestrator(provider).run({
      review,
      extractedDocuments,
      evidenceCandidates: socialEvidenceCandidates
    });
    const socialCall = (provider.generateText as ReturnType<typeof vi.fn>).mock.calls.find(
      ([input]) => input.task === "social_context_risk"
    )?.[0];
    const socialInput = JSON.parse(String(socialCall?.input));

    expect(
      socialInput.evidenceCandidates.slice(0, 2).map((candidate: { id: string }) => candidate.id)
    ).toEqual(["ev-social-campaign-name", "ev-uploaded-poster"]);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "social_context_risk",
          evidenceCandidateIds: ["ev-uploaded-poster", "ev-social-campaign-name"]
        })
      ])
    );
  });

  it("drops social context findings when no social-context evidence candidate is available", async () => {
    const genericSociallyWordedCandidates: RagEvidenceCandidate[] = [
      {
        id: "ev-generic-common-checklist",
        sourceType: "internal_policy",
        title: "금융상품 광고 준법심의 공통 체크리스트",
        quoteSummary: "소비자 정서와 사회적 논란 가능성을 고려해 오인 표현을 점검해야 한다.",
        relevanceScore: 0.91
      }
    ];
    const provider = providerReturning({
      social_context_risk: JSON.stringify({
        findings: [
          {
            title: "게시 예정일의 사회적 민감성 추가 확인 필요",
            issueType: "SOCIAL_CONTEXT_SENSITIVE_DATE",
            riskLevel: "caution",
            targetText: "게시 예정일: 2026-04-16",
            description: "민감일 근접 여부를 확인해야 합니다.",
            suggestedAction: "hold",
            suggestedCopy: "게시일을 민감일과 겹치지 않도록 점검해 주세요.",
            evidenceCandidateIds: ["evidence-rate-rule"],
            confidence: 0.75
          }
        ]
      })
    });

    const result = await createReviewSubAgentOrchestrator(provider).run({
      review,
      extractedDocuments,
      evidenceCandidates: genericSociallyWordedCandidates
    });

    expect(result).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ agent: "social_context_risk" })])
    );
  });

  it("passes computed material status to sub-agents so stale missingMaterials do not imply a missing ad original", async () => {
    const provider = providerReturning({});
    const completeDepositReview: ReviewCase = {
      ...review,
      productType: "deposit",
      missingMaterials: ["copy_draft"],
      files: [
        {
          id: "file-creative",
          name: "poster_finproof_daily_savings.png",
          fileType: "promotional_creative",
          classificationConfidence: 0.87,
          parseStatus: "parsed",
          contentType: "image/png",
          sizeBytes: 1024
        },
        {
          id: "file-copy",
          name: "copy_draft_daily_savings.txt",
          fileType: "copy_draft",
          classificationConfidence: 0.85,
          parseStatus: "parsed",
          contentType: "text/plain",
          sizeBytes: 1024
        },
        {
          id: "file-product",
          name: "product_description_daily_savings.txt",
          fileType: "product_description",
          classificationConfidence: 0.85,
          parseStatus: "parsed",
          contentType: "text/plain",
          sizeBytes: 1024
        },
        {
          id: "file-rate",
          name: "rate_table_daily_savings.csv",
          fileType: "rate_table",
          classificationConfidence: 0.91,
          parseStatus: "parsed",
          contentType: "text/csv",
          sizeBytes: 1024
        },
        {
          id: "file-checklist",
          name: "internal_checklist_daily_savings.txt",
          fileType: "checklist",
          classificationConfidence: 0.91,
          parseStatus: "parsed",
          contentType: "text/plain",
          sizeBytes: 1024
        }
      ]
    };

    await createReviewSubAgentOrchestrator(provider).run({
      review: completeDepositReview,
      extractedDocuments,
      evidenceCandidates
    });

    const creativeCall = (provider.generateText as ReturnType<typeof vi.fn>).mock.calls.find(
      ([input]) => input.task === "creative_review"
    )?.[0];
    const input = JSON.parse(String(creativeCall?.input));

    expect(input.review.missingMaterials).toEqual([]);
    expect(input.review.materialStatus.requiredMaterials).toEqual([
      { label: "홍보물 시안", fileType: "promotional_creative", status: "present" },
      { label: "원문 카피", fileType: "copy_draft", status: "present" },
      { label: "상품 설명서", fileType: "product_description", status: "present" },
      { label: "금리표", fileType: "rate_table", status: "present" },
      { label: "내부 체크리스트", fileType: "checklist", status: "present" }
    ]);
    expect(input.review.materialStatus.submittedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileType: "promotional_creative" }),
        expect.objectContaining({ fileType: "copy_draft" })
      ])
    );
  });
});

describe("finalOrchestratedFindings", () => {
  function socialFinding(overrides: Partial<AgentFinding>): AgentFinding {
    return {
      id: "finding",
      agent: "social_context_risk",
      issueType: "SOCIAL_CONTEXT_KG_DISASTER_DATE",
      riskLevel: "high",
      title: "사회맥락 리스크",
      targetText: "침몰 / 2026-04-16 / 금리",
      description: "설명",
      suggestedAction: "hold",
      suggestedCopy: "권고",
      evidenceCandidateIds: [],
      confidence: 0.8,
      ...overrides
    };
  }

  it("drops raw social-context findings the main agent already consolidated (rc-upload-002)", () => {
    // Reproduces rc-upload-002: the KG engine and the social_context_risk sub-agent both
    // flag the same 침몰/게시일 concern as high, and the main agent consolidates them into
    // one downgraded caution finding. The reviewer must see one issue, not three.
    const kgFinding = socialFinding({
      id: "finding-kg",
      issueType: "SOCIAL_CONTEXT_KG_DISASTER_DATE_FINANCIAL_METAPHOR",
      targetText: "2026-04-16 / 침몰 / 금리"
    });
    const subAgentFinding = socialFinding({
      id: "finding-subagent",
      issueType: "disaster_sensitivity",
      targetText: "침몰하는 금리 시장, 유일한 해답 (게시예정일 2026-04-16)"
    });
    const mainConsolidated: AgentFinding = socialFinding({
      id: "finding-main",
      agent: "main",
      issueType: "social_context_risk",
      riskLevel: "caution",
      targetText: "침몰하는 금리 시장, 유일한 해답 (게시예정일 2026-04-16)"
    });

    const result = finalOrchestratedFindings(
      [kgFinding, subAgentFinding],
      [mainConsolidated]
    );

    const socialContextConcerns = result.filter((finding) =>
      finding.targetText.includes("침몰")
    );
    expect(socialContextConcerns).toHaveLength(1);
    expect(socialContextConcerns[0]?.id).toBe("finding-main");
    expect(socialContextConcerns[0]?.riskLevel).toBe("caution");
  });

  it("dedupes when the main agent labels its social finding with a varying issueType", () => {
    // Regression for the rc-upload-002 re-analysis: the main agent consolidated the concern
    // under issueType "sensitive_expression_context" (not "social_context_risk"), and also
    // raised a distinct overstatement finding on the same phrase. The raw social findings
    // must collapse into the main social finding, while the overstatement finding survives.
    const kgFinding = socialFinding({
      id: "finding-kg",
      issueType: "SOCIAL_CONTEXT_KG_DISASTER_DATE_FINANCIAL_METAPHOR",
      targetText: "2026-04-16 / 침몰 / 금리"
    });
    const subAgentFinding = socialFinding({
      id: "finding-subagent",
      issueType: "disaster_sensitivity_and_symbolic_metaphor",
      targetText: "침몰하는 금리 시장, 유일한 해답 (게시 예정일 2026-04-16)"
    });
    const mainSocial: AgentFinding = socialFinding({
      id: "finding-main-social",
      agent: "main",
      issueType: "sensitive_expression_context",
      riskLevel: "caution",
      targetText: "침몰하는 금리 시장, 유일한 해답 (게시 예정일 2026-04-16)"
    });
    const mainOverstatement: AgentFinding = socialFinding({
      id: "finding-main-overstated",
      agent: "main",
      issueType: "overstated_claim",
      riskLevel: "caution",
      title: "'유일한 해답' 단정적 과장 표현",
      targetText: "침몰하는 금리 시장, 유일한 해답"
    });

    const result = finalOrchestratedFindings(
      [kgFinding, subAgentFinding],
      [mainSocial, mainOverstatement]
    );

    expect(result.map((finding) => finding.id)).toEqual([
      "finding-main-social",
      "finding-main-overstated"
    ]);
  });

  it("preserves social-context findings the main agent dropped entirely (safety net)", () => {
    const kgFinding = socialFinding({ id: "finding-kg" });
    const mainUnrelated: AgentFinding = socialFinding({
      id: "finding-main-rate",
      agent: "main",
      issueType: "rate_condition_visibility",
      riskLevel: "caution",
      title: "최고금리 조건 병기",
      targetText: "최고 연 4.50% (세전)"
    });

    const result = finalOrchestratedFindings([kgFinding], [mainUnrelated]);

    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "finding-kg" })])
    );
    expect(result).toHaveLength(2);
  });

  it("keeps a distinct social-context concern the main agent did not consolidate", () => {
    const dateConcern = socialFinding({
      id: "finding-date",
      targetText: "침몰 / 2026-04-16"
    });
    const targetingConcern = socialFinding({
      id: "finding-targeting",
      targetText: "고령층 대상 노후 불안 조장 문구"
    });
    const mainForDateOnly: AgentFinding = socialFinding({
      id: "finding-main-date",
      agent: "main",
      issueType: "social_context_risk",
      riskLevel: "caution",
      targetText: "침몰 표현과 2026-04-16 게시일 결합"
    });

    const result = finalOrchestratedFindings(
      [dateConcern, targetingConcern],
      [mainForDateOnly]
    );

    // The date concern is consolidated by main → dropped; the targeting concern is a
    // different cluster main never touched → preserved.
    expect(result.map((finding) => finding.id)).toEqual([
      "finding-targeting",
      "finding-main-date"
    ]);
  });
});

describe("dedupeConsolidatedSocialContextFindings", () => {
  function finding(overrides: Partial<AgentFinding>): AgentFinding {
    return {
      id: "finding",
      agent: "main",
      issueType: "generic",
      riskLevel: "caution",
      title: "제목",
      targetText: "문구",
      description: "설명",
      suggestedAction: "hold",
      suggestedCopy: "권고",
      evidenceCandidateIds: [],
      confidence: 0.8,
      ...overrides
    };
  }

  it("drops the KG-engine social finding the pipeline re-injected after main consolidated it", () => {
    // Reproduces rc-upload-002's second re-analysis: after the orchestrator dropped it,
    // the pipeline re-added the KG social finding (#1, high) alongside the main agent's
    // consolidated finding (#5, caution, issueType historical_sensitivity). The combined
    // set must collapse to the single main finding.
    const kg = finding({
      id: "finding-kg",
      agent: "social_context_risk",
      issueType: "SOCIAL_CONTEXT_KG_DISASTER_DATE_FINANCIAL_METAPHOR",
      riskLevel: "high",
      targetText: "2026-04-16 / 침몰 / 금리"
    });
    const disclosure = finding({
      id: "finding-disclosure",
      agent: "main",
      issueType: "disclosure_conflict",
      riskLevel: "high",
      targetText: "이 금융상품은 예금자보호법에 따라 보호되지 않습니다."
    });
    const mainSocial = finding({
      id: "finding-main-social",
      agent: "main",
      issueType: "historical_sensitivity",
      riskLevel: "caution",
      targetText: "침몰하는 금리 시장, 유일한 해답 (게시예정일 2026-04-16)"
    });

    const result = dedupeConsolidatedSocialContextFindings([kg, disclosure, mainSocial]);

    expect(result.map((f) => f.id)).toEqual(["finding-disclosure", "finding-main-social"]);
  });

  it("keeps the raw social finding when the main agent produced no social-context finding", () => {
    const kg = finding({
      id: "finding-kg",
      agent: "social_context_risk",
      issueType: "SOCIAL_CONTEXT_KG_DISASTER_DATE",
      riskLevel: "high",
      targetText: "2026-04-16 / 침몰 / 금리"
    });
    const rateOnly = finding({
      id: "finding-rate",
      agent: "main",
      issueType: "rate_disclosure",
      riskLevel: "caution",
      targetText: "최고 연 4.50% (세전)"
    });

    const result = dedupeConsolidatedSocialContextFindings([kg, rateOnly]);

    expect(result.map((f) => f.id)).toEqual(["finding-kg", "finding-rate"]);
  });
});

describe("sanitizeReviewerText", () => {
  it("replaces prior finding jargon and standalone finding with Korean phrasing", () => {
    expect(sanitizeReviewerText("prior finding들이 제기한 문제")).toBe(
      "기존 지적 사항들이 제기한 문제"
    );
    expect(sanitizeReviewerText("priorFindings 검토")).toBe("기존 지적 사항 검토");
    expect(sanitizeReviewerText("기존 finding 설명")).toBe("기존 지적 사항 설명");
  });

  it("replaces leaked internal field names", () => {
    expect(sanitizeReviewerText("evidenceCandidateIds가 누락됨")).toBe("제시된 근거가 누락됨");
    expect(sanitizeReviewerText("riskLevel을 낮춰야 함")).toBe("위험도을 낮춰야 함");
    expect(sanitizeReviewerText("targetText와 suggestedCopy 확인")).toBe(
      "지적 문구와 권고 문구 확인"
    );
  });

  it("leaves normal Korean reviewer text untouched", () => {
    const text = "연 5.5% 금리 조건을 인접 영역에 명시해 주세요.";
    expect(sanitizeReviewerText(text)).toBe(text);
  });
});
