import { describe, expect, it, vi } from "vitest";
import { ndjsonStream, streamReviewChat, type ReviewChatStreamDeps } from "./review-chat-stream";
import type { ChatProgressEvent } from "@/domain/chat";
import { getReviewCaseById } from "@/domain/reviews";

const review = getReviewCaseById("rc-demo-deposit-001")!;
const issue = review.issues[0];

function baseDeps(overrides: Partial<ReviewChatStreamDeps>): ReviewChatStreamDeps {
  return {
    classifyIntent: vi.fn().mockResolvedValue("none"),
    searchKnowledge: vi.fn().mockResolvedValue([]),
    lawClient: {
      searchLaw: vi.fn(),
      getLawText: vi.fn()
    },
    answer: vi.fn().mockResolvedValue({
      id: "msg-1",
      question: "q",
      answerType: "evidence_based",
      content: "답변",
      evidence: [],
      requiredMaterials: []
    }),
    coverageMinScore: 0.5,
    ...overrides
  };
}

async function collect(gen: AsyncGenerator<ChatProgressEvent>): Promise<ChatProgressEvent[]> {
  const events: ChatProgressEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("streamReviewChat", () => {
  it("never calls the MCP when intent is not law_search", async () => {
    const deps = baseDeps({ classifyIntent: vi.fn().mockResolvedValue("none") });
    const events = await collect(
      streamReviewChat({ review, issue, question: "이 문구 다듬어줘" }, deps)
    );

    expect(deps.lawClient.searchLaw).not.toHaveBeenCalled();
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({ authoritativeLawEvidence: [] })
    );
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("skips the MCP when the knowledge base already covers the law", async () => {
    const deps = baseDeps({
      classifyIntent: vi.fn().mockResolvedValue("law_search"),
      searchKnowledge: vi.fn().mockResolvedValue([
        { id: "e1", sourceType: "law", title: "전자금융거래법", quoteSummary: "x", relevanceScore: 0.8 }
      ])
    });
    await collect(streamReviewChat({ review, issue, question: "전자금융거래법 조항 찾아줘" }, deps));

    expect(deps.lawClient.searchLaw).not.toHaveBeenCalled();
  });

  it("calls the MCP and passes law evidence to answer when uncovered", async () => {
    const searchLaw = vi.fn().mockResolvedValue({ lawId: "123456", title: "전자금융거래법" });
    const getLawText = vi
      .fn()
      .mockResolvedValue({ text: "[현행]\n제1조 ...", effectiveFrom: "2026-07-01", isCurrent: true });
    const deps = baseDeps({
      classifyIntent: vi.fn().mockResolvedValue("law_search"),
      searchKnowledge: vi.fn().mockResolvedValue([]),
      lawClient: { searchLaw, getLawText }
    });

    const events = await collect(
      streamReviewChat({ review, issue, question: "전자금융거래법 관련 조항 찾아줘" }, deps)
    );

    expect(searchLaw).toHaveBeenCalledWith("전자금융거래법");
    expect(getLawText).toHaveBeenCalledWith({ lawId: "123456" });
    expect(events.some((e) => e.type === "mcp" && e.stage === "mcp_search_law")).toBe(true);
    expect(events.some((e) => e.type === "mcp" && e.stage === "mcp_get_law_text")).toBe(true);
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        authoritativeLawEvidence: [expect.objectContaining({ title: "전자금융거래법" })]
      })
    );
    const mcpStages = events
      .filter((e) => e.type === "mcp")
      .map((e) => (e as { stage: string }).stage);
    expect(mcpStages).toEqual(["mcp_search_law", "mcp_get_law_text"]);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("emits mcp_failed and RAG-only answer when search returns no identifier", async () => {
    const deps = baseDeps({
      classifyIntent: vi.fn().mockResolvedValue("law_search"),
      searchKnowledge: vi.fn().mockResolvedValue([]),
      lawClient: {
        searchLaw: vi.fn().mockResolvedValue({ title: "전자금융거래법" }),
        getLawText: vi.fn()
      }
    });

    const events = await collect(
      streamReviewChat({ review, issue, question: "전자금융거래법 조항 찾아줘" }, deps)
    );

    expect(deps.lawClient.getLawText).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "stage" && e.stage === "mcp_failed")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({ authoritativeLawEvidence: [] })
    );
  });

  it("degrades to RAG-only when the MCP throws", async () => {
    const deps = baseDeps({
      classifyIntent: vi.fn().mockResolvedValue("law_search"),
      searchKnowledge: vi.fn().mockResolvedValue([]),
      lawClient: {
        searchLaw: vi.fn().mockRejectedValue(new Error("timeout")),
        getLawText: vi.fn()
      }
    });

    const events = await collect(
      streamReviewChat({ review, issue, question: "전자금융거래법 조항 찾아줘" }, deps)
    );

    expect(events.some((e) => e.type === "stage" && e.stage === "mcp_failed")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({ authoritativeLawEvidence: [] })
    );
  });
});

describe("ndjsonStream", () => {
  it("serializes each event as one NDJSON line", async () => {
    async function* gen(): AsyncGenerator<ChatProgressEvent> {
      yield { type: "stage", stage: "analyzing_intent", label: "질문 의도 분석 중" };
      yield { type: "error", message: "done-sentinel" };
    }

    const stream = ndjsonStream(gen());
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }

    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ stage: "analyzing_intent" });
  });

  it("emits a sentinel error line when the generator throws mid-stream", async () => {
    async function* throwing(): AsyncGenerator<ChatProgressEvent> {
      yield { type: "stage", stage: "analyzing_intent", label: "의도 분석" };
      throw new Error("boom");
    }

    const stream = ndjsonStream(throwing());
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }

    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toMatchObject({ type: "error" });
  });
});
