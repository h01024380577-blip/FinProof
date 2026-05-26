import type { AnalysisArtifacts } from "./review-analysis-pipeline";
import { createAnalysisWorker } from "./analysis-worker";
import { createMockReviewStore } from "@/server/reviews";
import type { ReviewStoreScope } from "@/server/reviews";

const scope: ReviewStoreScope = {
  tenantId: "tenant-demo",
  actorUserId: "user-reviewer-demo",
  actorRole: "reviewer"
};

const artifacts: AnalysisArtifacts = {
  generatedAt: "2026-05-25T00:00:00.000Z",
  extractedDocuments: [
    {
      fileId: "file-demo-001",
      fileName: "deposit-poster.png",
      text: "최고 연 5.0%",
      confidence: 0.91,
      provider: "fixture-ocr"
    }
  ],
  evidenceCandidates: [
    {
      id: "evidence-candidate-file-demo-001-001",
      sourceType: "product_doc",
      title: "deposit-poster.png",
      quoteSummary: "최고 연 5.0%",
      relevanceScore: 0.86,
      sourceFileId: "file-demo-001"
    }
  ]
};

describe("analysis worker", () => {
  it("claims one queued job and completes it with OCR/RAG artifacts", async () => {
    const store = createMockReviewStore();
    await store.createReviewCaseFromSamplePackage(scope, {
      samplePackageId: "rc-demo-deposit-001"
    });
    await store.enqueueAnalysis(scope, "rc-demo-deposit-001");

    const worker = createAnalysisWorker({
      store,
      pipeline: {
        async run({ review }) {
          expect(review.id).toBe("rc-demo-deposit-001");

          return artifacts;
        }
      }
    });

    const result = await worker.runOnce({
      tenantId: "tenant-demo",
      workerId: "worker-001"
    });
    const latest = await store.getLatestAnalysisJob(scope, "rc-demo-deposit-001");

    expect(result).toEqual({
      processed: true,
      jobId: "job-rc-demo-deposit-001-001",
      reviewCaseId: "rc-demo-deposit-001",
      status: "completed"
    });
    expect(latest).toMatchObject({
      status: "completed",
      artifacts: expect.objectContaining({
        extractedDocuments: expect.any(Array),
        evidenceCandidates: expect.any(Array)
      })
    });
  });
});
