import {
  answerReviewQuestionWithModel,
  generateDraftWithModel,
  generateReportWithModel
} from "./review-ai-service";
import { getReviewCaseById } from "@/domain/reviews";
import type { ModelProvider } from "./model-provider";

function modelProvider(text: string): ModelProvider {
  return {
    generateText: vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-5.2",
      text
    })
  };
}

describe("review AI service", () => {
  const review = getReviewCaseById("rc-demo-deposit-001")!;
  const issue = review.issues[0];

  it("uses model text for chat while preserving evidence metadata", async () => {
    const provider = modelProvider("모델 근거 답변");
    const response = await answerReviewQuestionWithModel(
      {
        review,
        issue,
        question: "우대금리 조건을 어떻게 고지해야 하나요?"
      },
      provider
    );

    expect(response).toMatchObject({
      content: "모델 근거 답변",
      evidence: issue.evidence
    });
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "rag_chat",
        routeContext: { riskLevel: issue.riskLevel },
        input: expect.stringContaining(issue.evidence[0].quoteSummary),
        fallback: expect.any(String)
      })
    );
  });

  it("uses model text for draft generation", async () => {
    const provider = modelProvider("모델 수정 요청 초안");
    const draft = await generateDraftWithModel(review, [], provider);

    expect(draft).toBe("모델 수정 요청 초안");
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "opinion_draft",
        routeContext: expect.objectContaining({
          riskLevel: review.highestRiskLevel
        }),
        fallback: review.expectedDraft
      })
    );
  });

  it("uses model text for report markdown while keeping report metadata", async () => {
    const provider = modelProvider("# 모델 리포트");
    const report = await generateReportWithModel(
      {
        review,
        reportType: "change_request",
        tone: "formal",
        includeChatContext: true,
        issueIds: [issue.id]
      },
      provider
    );

    expect(report).toMatchObject({
      reportId: "report-rc-demo-deposit-001-v1",
      contentMarkdown: "# 모델 리포트",
      evidenceIds: expect.arrayContaining(issue.evidence.map((evidence) => evidence.id))
    });
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "report_generation",
        routeContext: expect.objectContaining({
          riskLevel: review.highestRiskLevel
        })
      })
    );
  });
});
