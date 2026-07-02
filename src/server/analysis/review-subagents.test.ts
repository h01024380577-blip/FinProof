import type { ReviewCase } from "@/domain/types";
import type { ModelProvider } from "@/server/ai/model-provider";
import { createReviewSubAgentOrchestrator, sanitizeReviewerText } from "./review-subagents";
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
    expect(sanitizeReviewerText("targetText와 suggestedCopy 확인")).toBe("지적 문구와 권고 문구 확인");
  });

  it("leaves normal Korean reviewer text untouched", () => {
    const text = "연 5.5% 금리 조건을 인접 영역에 명시해 주세요.";
    expect(sanitizeReviewerText(text)).toBe(text);
  });
});
