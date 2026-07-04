import type { ReviewCase } from "@/domain/types";
import type { ModelProvider } from "@/server/ai/model-provider";
import type { AgentFinding } from "./review-subagents";
import { runCoveEvidenceVerification } from "./cove-verification";

const review: ReviewCase = {
  id: "rc-cove-001",
  title: "CoVe 검증 테스트",
  affiliate: "전북은행",
  productType: "loan",
  channelType: ["mobile_banner"],
  plannedPublishDate: "2026-07-10",
  status: "analysis_waiting",
  highestRiskLevel: "info",
  requester: "요청자",
  reviewer: "심의자",
  promotionalCopy: "누구나 최고 연 5.0% 혜택",
  disclosure: "우대 조건 충족 시 적용됩니다.",
  productDescription: "대출 금리는 심사 결과에 따라 달라질 수 있습니다.",
  missingMaterials: [],
  files: [],
  issues: [],
  expectedDraft: "검토 필요",
  currentVersion: 1
};

const extractedDocuments = [
  {
    fileId: "file-copy",
    fileName: "copy.txt",
    text: "누구나 최고 연 5.0% 혜택 우대 조건 충족 시 적용됩니다.",
    confidence: 0.97,
    provider: "fixture-ocr"
  }
];

const policyEvidence = {
  id: "evidence-policy-rate",
  sourceType: "internal_policy" as const,
  documentId: "policy-rate",
  title: "대출 광고 금리 표시 지침",
  quoteSummary: "최고 금리는 적용 조건과 함께 표시해야 한다.",
  relevanceScore: 0.91
};

function finding(overrides: Partial<AgentFinding> = {}): AgentFinding {
  return {
    id: "finding-main-001",
    agent: "main",
    issueType: "rate_claim",
    riskLevel: "high",
    title: "최고 금리 조건 고지 필요",
    targetText: "최고 연 5.0%",
    description: "최고 금리 조건 고지가 필요합니다.",
    suggestedAction: "change_request",
    suggestedCopy: "최고 금리 적용 조건을 인접 영역에 명시해 주세요.",
    evidenceCandidateIds: [policyEvidence.id],
    confidence: 0.86,
    ...overrides
  };
}

function answerProvider(verdictByClaimType: Record<string, string>): ModelProvider {
  return {
    generateText: vi.fn(async (input) => {
      const body = JSON.parse(input.input) as {
        verificationQuestions: Array<{ id: string; claimType: string; evidenceCandidateIds: string[] }>;
      };

      return {
        provider: "deterministic" as const,
        model: "fixture",
        text: JSON.stringify({
          answers: body.verificationQuestions.map((question) => ({
            questionId: question.id,
            verdict: verdictByClaimType[question.claimType] ?? "supported",
            rationale:
              verdictByClaimType[question.claimType] === "unsupported"
                ? "인용 근거가 해당 판단을 직접 뒷받침하지 않습니다."
                : "인용 근거가 해당 판단을 직접 뒷받침합니다.",
            citedEvidenceCandidateIds: question.evidenceCandidateIds
          }))
        })
      };
    })
  };
}

describe("runCoveEvidenceVerification", () => {
  it("skips low-risk findings that do not affect reviewer action", async () => {
    const provider = answerProvider({});
    const lowRiskFinding = finding({
      riskLevel: "info",
      suggestedAction: "approve",
      confidence: 0.95
    });

    const result = await runCoveEvidenceVerification({
      review,
      extractedDocuments,
      evidenceCandidates: [policyEvidence],
      agentFindings: [lowRiskFinding],
      modelProvider: provider
    });

    expect(provider.generateText).not.toHaveBeenCalled();
    expect(result.artifacts.selection).toEqual([
      expect.objectContaining({ findingId: lowRiskFinding.id, mode: "none" })
    ]);
    expect(result.verifiedAgentFindings).toEqual([lowRiskFinding]);
  });

  it("downgrades a high-risk change request when CoVe cannot verify the risk/action support", async () => {
    const provider = answerProvider({ risk_action_support: "unsupported" });
    const highRiskFinding = finding();

    const result = await runCoveEvidenceVerification({
      review,
      extractedDocuments,
      evidenceCandidates: [policyEvidence],
      agentFindings: [highRiskFinding],
      modelProvider: provider
    });

    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "cove_evidence_answering",
        routeContext: expect.objectContaining({
          riskLevel: "high",
          sensitiveOutput: true
        })
      })
    );
    expect(result.artifacts.selection[0]).toEqual(
      expect.objectContaining({ findingId: highRiskFinding.id, mode: "llm" })
    );
    expect(result.artifacts.verdicts).toEqual([
      expect.objectContaining({
        findingId: highRiskFinding.id,
        status: "downgrade",
        correctedRiskLevel: "caution",
        correctedSuggestedAction: "hold"
      })
    ]);
    expect(result.verifiedAgentFindings[0]).toEqual(
      expect.objectContaining({
        riskLevel: "caution",
        suggestedAction: "hold",
        confidence: 0.68
      })
    );
  });

  it("downgrades a high-risk change request when semantic CoVe answers are empty", async () => {
    const provider: ModelProvider = {
      generateText: vi.fn(async () => ({
        provider: "anthropic",
        model: "claude-sonnet-5",
        text: "{\"answers\":[]}"
      }))
    };
    const highRiskFinding = finding();

    const result = await runCoveEvidenceVerification({
      review,
      extractedDocuments,
      evidenceCandidates: [policyEvidence],
      agentFindings: [highRiskFinding],
      modelProvider: provider
    });

    expect(result.artifacts.answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          questionId: `cove-${highRiskFinding.id}-evidence_support`,
          verdict: "insufficient",
          answeredBy: "fallback"
        }),
        expect.objectContaining({
          questionId: `cove-${highRiskFinding.id}-risk_action_support`,
          verdict: "insufficient",
          answeredBy: "fallback"
        })
      ])
    );
    expect(result.verifiedAgentFindings[0]).toEqual(
      expect.objectContaining({
        riskLevel: "caution",
        suggestedAction: "hold"
      })
    );
  });

  it("keeps a high-risk finding when every CoVe answer supports it", async () => {
    const provider = answerProvider({});
    const highRiskFinding = finding();

    const result = await runCoveEvidenceVerification({
      review,
      extractedDocuments,
      evidenceCandidates: [policyEvidence],
      agentFindings: [highRiskFinding],
      modelProvider: provider
    });

    expect(result.artifacts.verdicts).toEqual([
      expect.objectContaining({
        findingId: highRiskFinding.id,
        status: "verified"
      })
    ]);
    expect(result.verifiedAgentFindings).toEqual([highRiskFinding]);
  });

  it("emits cross-verification start/done progress events with counts", async () => {
    const provider = answerProvider({ risk_action_support: "unsupported" });
    const events: Array<Record<string, unknown>> = [];

    const result = await runCoveEvidenceVerification({
      review,
      extractedDocuments,
      evidenceCandidates: [policyEvidence],
      agentFindings: [finding()],
      modelProvider: provider,
      onEvent: (payload) => events.push(payload)
    });

    const start = events.find((e) => e.stage === "cove" && e.event === "start");
    const done = events.find((e) => e.stage === "cove" && e.event === "done");

    expect(start).toMatchObject({ stage: "cove", event: "start", case: review.id, verifying: 1 });
    // one high-risk change_request that CoVe could not verify -> downgraded (suppressed), 0 verified
    expect(done).toMatchObject({ stage: "cove", event: "done", case: review.id, verified: 0, suppressed: 1 });
    expect(typeof (done as Record<string, unknown>).ms).toBe("number");
    // done is emitted after the verdicts are computed, mirroring the returned artifacts
    expect(result.artifacts.verdicts[0]).toMatchObject({ status: "downgrade" });
  });

  it("does not require an onEvent sink", async () => {
    const provider = answerProvider({});
    await expect(
      runCoveEvidenceVerification({
        review,
        extractedDocuments,
        evidenceCandidates: [policyEvidence],
        agentFindings: [finding()],
        modelProvider: provider
      })
    ).resolves.toBeDefined();
  });

  it("downgrades case-history-only high findings even if semantic verification is unavailable", async () => {
    const provider = answerProvider({});
    const caseEvidence = {
      id: "case-history-001",
      sourceType: "case_history" as const,
      documentId: "case-001",
      title: "유사 심의 사례",
      quoteSummary: "유사 금리 표현이 과거 수정 요청되었습니다.",
      relevanceScore: 0.93
    };
    const highRiskFinding = finding({
      evidenceCandidateIds: [caseEvidence.id]
    });

    const result = await runCoveEvidenceVerification({
      review,
      extractedDocuments,
      evidenceCandidates: [caseEvidence],
      agentFindings: [highRiskFinding],
      modelProvider: provider
    });

    expect(result.artifacts.verdicts).toEqual([
      expect.objectContaining({
        findingId: highRiskFinding.id,
        status: "downgrade",
        correctedRiskLevel: "caution",
        correctedSuggestedAction: "hold"
      })
    ]);
    expect(result.verifiedAgentFindings[0]).toEqual(
      expect.objectContaining({
        riskLevel: "caution",
        suggestedAction: "hold"
      })
    );
  });
});
