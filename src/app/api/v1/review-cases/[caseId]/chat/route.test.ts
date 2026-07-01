const mocks = vi.hoisted(() => {
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
  const review = {
    id: "rc-demo-deposit-001",
    title: "최고 연 5.0% 적금 홍보물 심의",
    affiliate: "광주은행",
    productType: "deposit",
    channelType: ["mobile_app"],
    plannedPublishDate: "2026-06-10",
    status: "analysis_complete",
    highestRiskLevel: "high",
    requester: "마케팅1팀 김서연",
    reviewer: "준법심의자 박민준",
    promotionalCopy: "누구나 최고금리 혜택",
    disclosure: "우대조건 충족 시 최고 연 5.0%",
    productDescription: "",
    missingMaterials: [],
    files: [],
    issues: [],
    expectedDraft: "수정 요청"
  };
  const issue = {
    id: "issue-deposit-rate",
    issueType: "rate_advertising",
    riskLevel: "high",
    title: "조건부 최고금리 표현",
    targetText: "누구나 최고금리 혜택",
    targetBbox: [0, 0, 1, 1],
    sourceAgents: ["rag"],
    suggestedAction: "change_request",
    status: "open",
    description: "우대조건이 있는 최고금리를 무조건 혜택처럼 표현했습니다.",
    suggestedCopy: "우대 조건 충족 고객에게 최고금리 혜택",
    evidence: []
  };
  const service = {
    getReviewCase: vi.fn(async () => review),
    getIssue: vi.fn(async () => issue),
    searchKnowledgeEvidence: vi.fn(async () => knowledgeEvidence)
  };

  return {
    knowledgeEvidence,
    service,
    embed: vi.fn(async () => [[0.1, 0.2, 0.3]]),
    rerank: vi.fn(async ({ candidates }: { candidates: typeof knowledgeEvidence }) => candidates),
    answerReviewQuestionWithModel: vi.fn(async (input) => ({
      id: "chat-evidence",
      question: input.question,
      answerType: "evidence_based",
      content: "승인된 지식문서 근거 답변",
      evidence: input.knowledgeEvidence,
      requiredMaterials: []
    }))
  };
});

vi.mock("@/server/reviews/review-service", () => ({
  createReviewService: () => mocks.service
}));

vi.mock("@/server/ai/review-ai-service", () => ({
  answerReviewQuestionWithModel: mocks.answerReviewQuestionWithModel
}));

vi.mock("@/server/knowledge/embedding-provider", () => ({
  createEmbeddingProvider: () => ({
    model: "fixture-embedding",
    embed: mocks.embed
  })
}));

vi.mock("@/server/analysis/rerank-provider", () => ({
  createReranker: () => ({
    provider: "fixture-reranker",
    rerank: mocks.rerank
  })
}));

vi.mock("@/server/analysis/provider-config", () => ({
  getAnalysisProviderConfig: () => ({
    rag: {
      topK: 2,
      minScore: 0.1,
      maxContextChars: 6000
    },
    rerank: {
      topK: 2
    }
  })
}));

vi.mock("@/server/ai/law-search-intent", () => ({
  classifyLawSearchIntent: vi.fn(async () => "none" as const)
}));

vi.mock("@/server/regulatory/korean-law-mcp-client", () => ({
  createKoreanLawMcpClient: () => ({
    searchLaw: vi.fn(),
    getLawText: vi.fn()
  })
}));

import { POST } from "./route";

describe("review case chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retrieves approved knowledge evidence and passes it to the chat model", async () => {
    const request = new Request("http://localhost/api/v1/review-cases/rc-demo-deposit-001/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-finproof-role": "reviewer"
      },
      body: JSON.stringify({
        issueId: "issue-deposit-rate",
        question: "금융규제 가이드라인에서 최고 금리 표시 조건을 알려줘"
      })
    });

    const response = await POST(request, {
      params: Promise.resolve({ caseId: "rc-demo-deposit-001" })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");

    const streamText = await response.text();
    const events = streamText
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string });
    expect(events.some((event) => event.type === "done")).toBe(true);

    expect(mocks.service.searchKnowledgeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-demo",
        role: "reviewer"
      }),
      expect.objectContaining({
        query: expect.stringContaining("금융규제 가이드라인"),
        productType: "deposit",
        queryEmbedding: [0.1, 0.2, 0.3]
      })
    );
    expect(mocks.rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("금융규제 가이드라인"),
        candidates: mocks.knowledgeEvidence
      })
    );
    expect(mocks.answerReviewQuestionWithModel).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeEvidence: mocks.knowledgeEvidence
      })
    );
  });
});
