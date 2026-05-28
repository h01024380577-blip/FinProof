import type { AnalysisArtifacts } from "@/server/analysis/review-analysis-pipeline";

const transactionMock = vi.fn(async () => ({ issueCount: 0, evidenceCount: 0 }));

vi.mock("@/server/db/prisma", () => ({
  getPrismaClient: () => ({
    $transaction: transactionMock,
    knowledgeDocument: {
      findFirst: vi.fn(async () => ({ id: "knowledge-001" }))
    }
  })
}));

import { createPrismaReviewStore } from "./prisma-review-store";

const scope = {
  tenantId: "tenant-demo",
  actorUserId: "user-reviewer-demo",
  actorRole: "reviewer" as const
};

const artifacts: AnalysisArtifacts = {
  generatedAt: "2026-05-27T00:00:00.000Z",
  extractedDocuments: [],
  evidenceCandidates: [],
  findings: []
};

describe("prisma review store transactions", () => {
  beforeEach(() => {
    transactionMock.mockClear();
  });

  it("extends the transaction timeout when persisting analysis outputs", async () => {
    const store = createPrismaReviewStore();

    await store.persistAnalysisOutputs(scope, {
      reviewCaseId: "rc-demo-deposit-001",
      jobId: "job-rc-demo-deposit-001-001",
      artifacts
    });

    const transactionOptions = transactionMock.mock.calls[0]?.[1] as { timeout?: number };
    expect(transactionOptions?.timeout).toBeGreaterThan(5000);
  });

  it("extends the transaction timeout when replacing knowledge document chunks", async () => {
    const store = createPrismaReviewStore();

    await store.replaceKnowledgeDocumentChunks(scope, "knowledge-001", []);

    const transactionOptions = transactionMock.mock.calls[0]?.[1] as { timeout?: number };
    expect(transactionOptions?.timeout).toBeGreaterThan(5000);
  });
});
