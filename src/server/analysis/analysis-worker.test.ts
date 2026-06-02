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

  it("fails stale running jobs at startup before claiming new work", async () => {
    const store = createMockReviewStore();
    await store.createReviewCaseFromSamplePackage(scope, {
      samplePackageId: "rc-demo-deposit-001"
    });
    await store.enqueueAnalysis(scope, "rc-demo-deposit-001");

    // Claim the job to put it in "running" state (simulates a dead worker)
    await store.claimNextAnalysisJob("tenant-demo", "worker-stale");

    // With threshold=0, any running job is considered stale
    const worker = createAnalysisWorker({
      store,
      pipeline: { async run({ review }) { void review; return artifacts; } },
      staleJobThresholdMs: 0
    });

    // runOnce should fail the stale job, but there's nothing left in the queue to claim
    const result = await worker.runOnce({ tenantId: "tenant-demo", workerId: "worker-new" });

    expect(result).toEqual({ processed: false });

    // Verify the stale job was actually failed
    const latest = await store.getLatestAnalysisJob(scope, "rc-demo-deposit-001");
    expect(latest?.status).toBe("failed");
    expect(latest?.errorMessage).toMatch(/stale/);

    // Verify the case was also reset so it can be re-queued
    const reviewCase = await store.getReviewCase(scope, "rc-demo-deposit-001");
    expect(reviewCase?.status).toBe("analysis_waiting");
  });

  it("uses the configured storage adapter when building the default pipeline", async () => {
    const store = createMockReviewStore();
    await store.createReviewCaseFromUploadedFiles(scope, {
      reviewCaseId: "rc-worker-upload-001",
      title: "업로드 본문 분석",
      affiliate: "광주은행",
      productType: "deposit",
      channelType: ["poster"],
      plannedPublishDate: "2026-06-20",
      files: [
        {
          id: "file-upload-html-001",
          name: "poster.html",
          type: "text/html",
          size: 96,
          storageProvider: "local",
          storageKey: "local/rc-worker-upload-001/file-upload-html-001/poster.html"
        }
      ]
    });
    await store.enqueueAnalysis(scope, "rc-worker-upload-001");

    const worker = createAnalysisWorker({
      store,
      storage: {
        async getReviewFileBody(storageKey) {
          expect(storageKey).toBe("local/rc-worker-upload-001/file-upload-html-001/poster.html");

          return new TextEncoder().encode(
            "<h1>누구나 최고 연 5.0%</h1><p>급여이체 등 우대 조건 충족 시 적용됩니다.</p>"
          );
        },
        async getFileBody(storageKey) {
          return this.getReviewFileBody(storageKey);
        },
        async putReviewFile() {
          throw new Error("not used");
        },
        async putKnowledgeDocumentFile() {
          throw new Error("not used");
        },
        sampleReviewFile() {
          throw new Error("not used");
        }
      }
    });

    const result = await worker.runOnce({
      tenantId: "tenant-demo",
      workerId: "worker-storage"
    });
    const latest = await store.getLatestAnalysisJob(scope, "rc-worker-upload-001");

    expect(result).toMatchObject({ processed: true, status: "completed" });
    expect(latest?.artifacts?.extractedDocuments).toEqual([
      expect.objectContaining({
        fileName: "poster.html",
        provider: "local-text-extractor",
        text: expect.stringContaining("누구나 최고 연 5.0%")
      })
    ]);
  });
});
