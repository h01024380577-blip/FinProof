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

  it("uses knowledgeMinScore as the retrieval floor when it is lower than minScore", async () => {
    const store = createMockReviewStore([]);
    const document = await store.createKnowledgeDocument(scope, {
      id: "knowledge-loan-checklist",
      documentType: "checklist",
      productType: "loan",
      title: "대출 광고 심의 체크리스트",
      version: "2026.05",
      effectiveFrom: "2026-05-27",
      storageKey: "local/knowledge-documents/knowledge-loan-checklist/checklist.pdf"
    });
    await store.approveKnowledgeDocument(scope, document.id);
    await store.replaceKnowledgeDocumentChunks(scope, document.id, [
      {
        id: "chunk-loan-checklist-001",
        tenantId: scope.tenantId,
        knowledgeDocumentId: document.id,
        chunkText: "연이자율과 연체이자율, 중도상환수수료를 광고에 표시해야 한다.",
        chunkSummary: "대출 광고 금리 표시 점검",
        embeddingModel: "text-embedding-3-small",
        embeddingId: "embedding-loan-checklist-001",
        metadata: { source: "knowledge_document" }
      }
    ]);

    // A partial-overlap query lands between the two thresholds.
    const query = "대출 광고 최저금리 연 3.9% 중도상환수수료 면제 누구나 즉시 승인";

    const excluded = await store.searchKnowledgeEvidence(scope, {
      query,
      productType: "loan",
      topK: 4,
      minScore: 0.99
    });
    expect(excluded).toHaveLength(0);

    const included = await store.searchKnowledgeEvidence(scope, {
      query,
      productType: "loan",
      topK: 4,
      minScore: 0.99,
      knowledgeMinScore: 0.05
    });
    expect(included.map((item) => item.documentId)).toContain(document.id);
  });
});
