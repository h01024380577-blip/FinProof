import { createMockReviewStore } from "./mock-review-store";

const scope = {
  tenantId: "tenant-demo",
  actorUserId: "user-reviewer-demo",
  actorRole: "reviewer" as const
};

describe("mock review store knowledge search", () => {
  it("matches approved knowledge documents by title as well as chunk text", async () => {
    const store = createMockReviewStore([]);
    const document = await store.createKnowledgeDocument(scope, {
      id: "knowledge-rate-guideline",
      documentType: "guide",
      title: "금융규제 가이드라인",
      version: "2026.05",
      effectiveFrom: "2026-05-27",
      storageKey: "local/knowledge-documents/knowledge-rate-guideline/rate-guideline.pdf"
    });

    await store.approveKnowledgeDocument(scope, document.id);
    await store.replaceKnowledgeDocumentChunks(scope, document.id, [
      {
        id: "chunk-rate-guideline-001",
        tenantId: scope.tenantId,
        knowledgeDocumentId: document.id,
        chunkText: "이 첨부파일은 메타데이터 기반으로 색인되었습니다.",
        chunkSummary: "PDF 메타데이터 색인",
        embeddingModel: "text-embedding-3-small",
        embeddingId: "embedding-rate-guideline-001",
        metadata: { source: "knowledge_document" }
      }
    ]);

    const evidence = await store.searchKnowledgeEvidence(scope, {
      query: "금융규제 가이드라인에서 최고 금리 표시 조건을 알려줘",
      topK: 4,
      minScore: 0.72
    });

    expect(evidence[0]).toMatchObject({
      documentId: document.id,
      title: "금융규제 가이드라인"
    });
  });
});
