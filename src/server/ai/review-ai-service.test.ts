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
        instructions: expect.stringContaining("FinProof rag_chat assistant"),
        input: expect.stringContaining(issue.evidence[0].quoteSummary),
        fallback: expect.any(String)
      })
    );
    expect(vi.mocked(provider.generateText).mock.calls[0]?.[0].instructions).toContain(
      "Never expose internal evidence identifiers"
    );
  });

  it("includes prior chat turns in the RAG chat prompt", async () => {
    const provider = modelProvider("이전 대화를 반영한 답변");
    await answerReviewQuestionWithModel(
      {
        review,
        issue,
        question: "그럼 짧은 배너 문구는요?",
        history: [
          {
            question: "어떤 조건을 함께 써야 하나요?",
            answer: "기본금리와 우대조건을 같이 써야 합니다."
          }
        ]
      },
      provider
    );

    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "rag_chat",
        input: expect.stringContaining("어떤 조건을 함께 써야 하나요?")
      })
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining("기본금리와 우대조건을 같이 써야 합니다.")
      })
    );
  });

  it("includes approved knowledge document evidence in RAG chat prompts and citations", async () => {
    const provider = modelProvider("승인된 지식문서 근거 답변");
    const knowledgeEvidence = [
      {
        id: "knowledge-evidence-rate-ad-rule",
        sourceType: "law" as const,
        documentId: "knowledge-rate-ad-rule",
        chunkId: "chunk-rate-ad-rule-001",
        version: "2026.05",
        effectiveFrom: "2026-05-01",
        title: "금융규제 가이드라인",
        section: "최고 금리 표시 조건",
        quoteSummary: "최고금리는 우대조건 및 적용대상과 함께 명확히 표시해야 합니다.",
        relevanceScore: 0.94
      }
    ];

    const response = await answerReviewQuestionWithModel(
      {
        review,
        issue,
        question: "금융규제 가이드라인에서 최고 금리 표시 조건을 알려줘",
        knowledgeEvidence
      },
      provider
    );

    expect(response.evidence).toEqual(expect.arrayContaining(knowledgeEvidence));
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining("금융규제 가이드라인")
      })
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining(
          "최고금리는 우대조건 및 적용대상과 함께 명확히 표시해야 합니다."
        )
      })
    );
  });

  it("injects authoritative law evidence as a separate prompt axis", async () => {
    const provider = modelProvider("법령 원문 기반 답변");
    await answerReviewQuestionWithModel(
      {
        review,
        issue,
        question: "전자금융거래법 관련 조항 찾아줘",
        knowledgeEvidence: [],
        authoritativeLawEvidence: [
          {
            id: "law-mcp-123456",
            sourceType: "law",
            title: "전자금융거래법",
            quoteSummary: "제1조 목적 ...",
            relevanceScore: 0.9,
            effectiveFrom: "2026-07-01",
            section: "[현행]"
          }
        ]
      },
      provider
    );

    const call = vi.mocked(provider.generateText).mock.calls[0]?.[0];
    expect(call?.input).toContain("authoritativeLawEvidence");
    expect(call?.input).toContain("전자금융거래법");
    expect(call?.instructions).toContain("authoritativeLawEvidence");
  });

  it("removes uploaded file names from chat answer text", async () => {
    const uploadedFileName = "finproof-pipeline-retest-20260527.txt";
    const provider = modelProvider(
      `${uploadedFileName} 기준으로 우대 조건을 인접 고지해야 합니다.`
    );
    const response = await answerReviewQuestionWithModel(
      {
        review,
        issue: {
          ...issue,
          evidence: [
            {
              id: "evidence-uploaded-file",
              sourceType: "product_doc",
              title: uploadedFileName,
              quoteSummary: "우대금리 조건",
              relevanceScore: 0.92
            }
          ]
        },
        question: "이 문구의 근거를 확인해줘"
      },
      provider
    );

    expect(response.content).toBe("업로드 자료 기준으로 우대 조건을 인접 고지해야 합니다.");
  });

  it("removes internal approved knowledge evidence ids from chat answer text", async () => {
    const provider = modelProvider(
      "근거: 「금융규제 가이드라인」(광고 정보 일부 제외 시 소비자 오인 방지 관련, approvedKnowledgeEvidence 008)"
    );
    const response = await answerReviewQuestionWithModel(
      {
        review,
        issue,
        question: "근거를 알려줘"
      },
      provider
    );

    expect(response.content).toBe(
      "근거: 「금융규제 가이드라인」(광고 정보 일부 제외 시 소비자 오인 방지 관련)"
    );
  });

  it("uses model text for draft generation", async () => {
    const provider = modelProvider("모델 수정 요청 초안");
    const draft = await generateDraftWithModel(review, [], provider);
    const call = vi.mocked(provider.generateText).mock.calls[0]?.[0];

    expect(draft).toBe("모델 수정 요청 초안");
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "opinion_draft",
        routeContext: expect.objectContaining({
          riskLevel: review.highestRiskLevel
        }),
        instructions: expect.stringContaining("FinProof opinion_draft assistant"),
        fallback: expect.stringContaining(issue.title)
      })
    );
    expect(call?.instructions).toContain("Reflect every supplied review issue");
    expect(call?.input).toContain(issue.title);
    expect(call?.input).toContain(issue.suggestedCopy);
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
        }),
        instructions: expect.stringContaining("FinProof report_generation assistant")
      })
    );
    expect(vi.mocked(provider.generateText).mock.calls[0]?.[0].instructions).toContain(
      "Treat fallback as the canonical source of truth"
    );
  });
});
