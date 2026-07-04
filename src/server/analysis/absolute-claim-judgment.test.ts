import { describe, expect, it, vi } from "vitest";
import type { ReviewCase } from "@/domain/types";
import type { ModelProvider } from "@/server/ai/model-provider";
import { judgeAbsoluteClaims } from "./absolute-claim-judgment";

const review: ReviewCase = {
  id: "rc-absolute-judge-001",
  title: "절대 표현 문맥 판단",
  affiliate: "FinProof Bank",
  productType: "deposit",
  channelType: ["poster"],
  plannedPublishDate: "2026-07-12",
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

const document = (text: string) => [
  {
    fileId: "file-poster",
    fileName: "poster.pdf",
    text,
    confidence: 0.94,
    provider: "gemini-ocr"
  }
];

const providerReturning = (payload: string): ModelProvider => ({
  generateText: vi.fn(async () => ({
    provider: "anthropic" as const,
    model: "claude-test",
    text: payload
  }))
});

describe("judgeAbsoluteClaims", () => {
  it("drops a benign cautionary '반드시' the model judges as not misleading", async () => {
    const provider = providerReturning(
      JSON.stringify({
        verdicts: [{ candidateId: "absolute-1", misleading: false, reason: "소비자 주의 안내" }]
      })
    );

    const judgment = await judgeAbsoluteClaims({
      review,
      extractedDocuments: document("가입 전 반드시 상품설명서를 확인하세요."),
      modelProvider: provider
    });

    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ task: "absolute_claim_judgment" })
    );
    expect(judgment.decision).toBeNull();
  });

  it("keeps a '반드시' the model judges as a guaranteed-benefit claim", async () => {
    const provider = providerReturning(
      JSON.stringify({
        verdicts: [{ candidateId: "absolute-1", misleading: true, reason: "혜택을 조건 없이 보장" }]
      })
    );

    const judgment = await judgeAbsoluteClaims({
      review,
      extractedDocuments: document("가입하면 반드시 우대금리를 지급합니다."),
      modelProvider: provider
    });

    expect(judgment.decision).toMatchObject({
      misleading: true,
      targetText: "반드시",
      reason: "혜택을 조건 없이 보장",
      judgedBy: "llm"
    });
  });

  it("judges each span independently — benign '반드시' dropped while '누구나' kept", async () => {
    const provider = providerReturning(
      JSON.stringify({
        verdicts: [
          { candidateId: "absolute-1", misleading: true, reason: "무조건 지급 단정" },
          { candidateId: "absolute-2", misleading: false, reason: "약관 확인 안내" }
        ]
      })
    );

    const judgment = await judgeAbsoluteClaims({
      review,
      extractedDocuments: document("누구나 무조건 지급받습니다. 가입 전 반드시 확인하세요."),
      modelProvider: provider
    });

    expect(judgment.candidates.length).toBeGreaterThanOrEqual(2);
    expect(judgment.decision?.misleading).toBe(true);
  });

  it("returns no decision when the text has no absolute expressions (no model call)", async () => {
    const provider = providerReturning("{}");

    const judgment = await judgeAbsoluteClaims({
      review,
      extractedDocuments: document("연 4.5% 자유적금 상품 안내입니다."),
      modelProvider: provider
    });

    expect(provider.generateText).not.toHaveBeenCalled();
    expect(judgment.decision).toBeNull();
  });

  it("defers to the lexical fallback (undefined decision) when the model returns nothing", async () => {
    const provider = providerReturning('{"verdicts":[]}');

    const judgment = await judgeAbsoluteClaims({
      review,
      extractedDocuments: document("가입 전 반드시 약관을 확인하세요."),
      modelProvider: provider
    });

    expect(judgment.decision).toBeUndefined();
  });
});
