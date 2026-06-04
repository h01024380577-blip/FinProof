import type { AnalysisArtifacts } from "@/server/analysis/review-analysis-pipeline";

const transactionMock = vi.fn(async () => ({ issueCount: 0, evidenceCount: 0 }));
const userFindFirstMock = vi.fn(async () => ({ id: "user-reviewer-demo" }));
const auditLogCreateMock = vi.fn(async ({ data }) => ({
  id: data.id,
  tenantId: data.tenantId,
  userId: data.userId ?? null,
  action: data.action,
  targetType: data.targetType,
  targetId: data.targetId ?? null,
  beforeValue: data.beforeValue ?? null,
  afterValue: data.afterValue ?? null,
  ipAddress: data.ipAddress ?? null,
  createdAt: new Date("2026-06-04T00:00:00.000Z")
}));

vi.mock("@/server/db/prisma", () => ({
  getPrismaClient: () => ({
    $transaction: transactionMock,
    user: {
      findFirst: userFindFirstMock
    },
    auditLog: {
      create: auditLogCreateMock
    },
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
    userFindFirstMock.mockReset();
    userFindFirstMock.mockResolvedValue({ id: "user-reviewer-demo" });
    auditLogCreateMock.mockClear();
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

  it("records audit events without a user id when the actor is not present in Prisma", async () => {
    userFindFirstMock.mockResolvedValueOnce(null);
    const store = createPrismaReviewStore();

    const event = await store.recordAuditEvent(
      { ...scope, actorUserId: "missing-demo-user" },
      {
        action: "review_case.history.delete",
        targetType: "review_case",
        targetId: "rc-history-approved-001"
      }
    );

    expect(userFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "missing-demo-user",
        tenantId: "tenant-demo"
      },
      select: { id: true }
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null
        })
      })
    );
    expect(event.userId).toBe("");
  });
});
