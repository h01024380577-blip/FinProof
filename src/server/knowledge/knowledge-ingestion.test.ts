// @vitest-environment node

import { createKnowledgeDocumentChunks, extractKnowledgeDocumentText } from "./knowledge-ingestion";

describe("knowledge document ingestion", () => {
  it("extracts text bodies and creates embedded chunks for vector search", async () => {
    const body = new TextEncoder().encode(
      "최고 금리 표현은 우대 조건과 한도를 같은 화면에 표시해야 합니다.\n\n" +
        "가입 대상, 기간, 한도, 중도해지 이율은 소비자가 오인하지 않도록 명확히 고지합니다."
    );
    const text = await extractKnowledgeDocumentText({
      fileName: "deposit-policy.txt",
      contentType: "text/plain",
      body
    });
    const embed = vi.fn(async (texts: string[]) =>
      texts.map((_, index) => [index + 0.1, index + 0.2, index + 0.3])
    );

    const chunks = await createKnowledgeDocumentChunks({
      tenantId: "tenant-demo",
      documentId: "knowledge-001",
      text,
      embeddingProvider: {
        model: "fixture-embedding",
        embed
      }
    });

    expect(text).toContain("최고 금리 표현");
    expect(embed).toHaveBeenCalledWith([expect.stringContaining("가입 대상, 기간, 한도")]);
    expect(chunks).toEqual([
      expect.objectContaining({
        id: "chunk-knowledge-001-001",
        tenantId: "tenant-demo",
        knowledgeDocumentId: "knowledge-001",
        chunkText: expect.stringContaining("중도해지 이율"),
        chunkSummary: expect.stringContaining("최고 금리 표현"),
        embeddingModel: "fixture-embedding",
        embeddingId: "embedding-knowledge-001-001",
        metadata: expect.objectContaining({
          source: "knowledge_document",
          chunkIndex: 0,
          embeddingVector: [0.1, 0.2, 0.3]
        })
      })
    ]);
  });
});
