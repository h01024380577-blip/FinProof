import { createMockReviewStore } from "./mock-review-store";
import JSZip from "jszip";
import type { AnalysisArtifacts } from "@/server/analysis/review-analysis-pipeline";
import { createLocalMetadataStorageAdapter } from "@/server/storage/local-metadata-storage-adapter";
import {
  availableActionsFor,
  createReviewService,
  resetReviewServiceStateForTests
} from "./review-service";
import type { ReviewStorageAdapter } from "@/server/storage";
import { UnsafeUploadError, type UploadScanner } from "@/server/storage/upload-security";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const reviewerContext = {
  tenantId: "tenant-demo",
  userId: "user-reviewer-demo",
  role: "reviewer" as const,
  ipAddress: "203.0.113.10"
};

const reviewerStoreScope = {
  tenantId: reviewerContext.tenantId,
  actorUserId: reviewerContext.userId,
  actorRole: reviewerContext.role,
  ipAddress: reviewerContext.ipAddress
};

const requesterContext = {
  tenantId: "tenant-demo",
  userId: "user-requester-demo",
  role: "requester" as const
};

const artifacts: AnalysisArtifacts = {
  generatedAt: "2026-05-25T00:00:00.000Z",
  extractedDocuments: [
    {
      fileId: "file-upload-001",
      fileName: "poster.png",
      text: "최고 연 5.0%",
      confidence: 0.91,
      provider: "fixture-ocr"
    }
  ],
  evidenceCandidates: [
    {
      id: "evidence-candidate-file-upload-001-001",
      sourceType: "product_doc",
      title: "poster.png",
      quoteSummary: "최고 연 5.0%",
      relevanceScore: 0.86,
      sourceFileId: "file-upload-001"
    }
  ]
};

async function zipBody(entries: Record<string, string>) {
  const zip = new JSZip();

  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }

  return zip.generateAsync({ type: "uint8array" });
}

describe("review service", () => {
  beforeEach(() => {
    resetReviewServiceStateForTests();
  });

  it("blocks requester analysis start", async () => {
    const service = createReviewService({ store: createMockReviewStore() });

    await expect(service.startAnalysis(requesterContext, "rc-demo-deposit-001")).rejects.toThrow(
      "Reviewer or Compliance Admin role is required to start analysis"
    );
  });

  it("derives available actions from role and review status", () => {
    expect(availableActionsFor("requester", "analysis_waiting")).toEqual([]);
    expect(availableActionsFor("reviewer", "analysis_waiting")).toEqual(["start_analysis"]);
    expect(availableActionsFor("compliance_admin", "analysis_waiting")).toEqual(["start_analysis"]);
    expect(availableActionsFor("requester", "analysis_complete")).toEqual([
      "open_workbench",
      "view_audit"
    ]);
    expect(availableActionsFor("reviewer", "change_requested")).toEqual(["view_audit"]);
  });

  it("returns not-started analysis status before a job exists", async () => {
    const store = createMockReviewStore();
    const service = createReviewService({ store });

    await service.createReviewCaseFromSamplePackage(reviewerContext, {
      samplePackageId: "rc-demo-deposit-001"
    });

    await expect(
      service.getAnalysisStatus(reviewerContext, "rc-demo-deposit-001")
    ).resolves.toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "not_started",
      progress: 0,
      currentStep: "waiting_for_reviewer",
      jobId: null
    });
  });

  it("starts analysis and records audit for reviewers", async () => {
    const store = createMockReviewStore();
    const service = createReviewService({ store });

    await service.createReviewCaseFromSamplePackage(reviewerContext, {
      samplePackageId: "rc-demo-deposit-001"
    });
    const result = await service.startAnalysis(reviewerContext, "rc-demo-deposit-001");
    const auditEvents = await service.listAuditEvents(
      reviewerContext,
      "review_case",
      "rc-demo-deposit-001"
    );

    expect(result).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "analysis_complete",
      jobId: "job-rc-demo-deposit-001-001"
    });
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "analysis.start",
          targetType: "review_case",
          targetId: "rc-demo-deposit-001",
          userId: "user-reviewer-demo",
          ipAddress: "203.0.113.10"
        }),
        expect.objectContaining({
          action: "analysis.complete",
          targetType: "review_case",
          targetId: "rc-demo-deposit-001",
          userId: "user-reviewer-demo",
          ipAddress: "203.0.113.10"
        })
      ])
    );
  });

  it("stores OCR/RAG artifacts when analysis starts", async () => {
    const store = createMockReviewStore();
    const service = createReviewService({
      store,
      analysisPipeline: {
        async run({ review }) {
          return {
            generatedAt: "2026-05-25T00:00:00.000Z",
            extractedDocuments: review.files.map((file) => ({
              fileId: file.id,
              fileName: file.name,
              storageKey: file.storageKey,
              text: "최고 연 5.0% 우대금리 조건 추출",
              confidence: 0.92,
              provider: "fixture-ocr"
            })),
            evidenceCandidates: [
              {
                id: "evidence-candidate-file-upload-001-001",
                sourceType: "product_doc",
                title: "poster.png",
                quoteSummary: "최고 연 5.0% 우대금리 조건 추출",
                relevanceScore: 0.86,
                sourceFileId: "file-upload-001"
              }
            ]
          };
        }
      }
    });

    const created = await service.createReviewCaseFromUploadedFiles(requesterContext, {
      title: "실제 업로드 적금 홍보물",
      affiliate: "광주은행",
      productType: "deposit",
      channelType: ["poster"],
      plannedPublishDate: "2026-06-20",
      files: [
        {
          name: "real-deposit-poster.png",
          type: "image/png",
          size: 2048,
          body: new Uint8Array([1, 2, 3])
        }
      ]
    });

    const result = await service.startAnalysis(reviewerContext, created.reviewCase.id);
    const job = await service.getLatestAnalysisJob(reviewerContext, created.reviewCase.id);

    expect(result).toMatchObject({
      extractedDocumentCount: 1,
      evidenceCandidateCount: 1
    });
    expect(job?.artifacts).toMatchObject({
      extractedDocuments: [
        expect.objectContaining({
          fileId: "file-upload-001",
          provider: "fixture-ocr"
        })
      ],
      evidenceCandidates: [
        expect.objectContaining({
          sourceType: "product_doc",
          relevanceScore: 0.86
        })
      ]
    });
  });

  it("turns real upload OCR/RAG artifacts into review issues and evidence", async () => {
    const store = createMockReviewStore([]);
    const service = createReviewService({
      store,
      analysisPipeline: {
        async run({ review }) {
          return {
            generatedAt: "2026-05-26T00:00:00.000Z",
            extractedDocuments: review.files.map((file) => ({
              fileId: file.id,
              fileName: file.name,
              storageKey: file.storageKey,
              text: "최고 연 5.0% 금리를 누구나 받을 수 있는 적금 상품입니다.",
              confidence: 0.93,
              provider: "fixture-ocr"
            })),
            evidenceCandidates: [
              {
                id: "evidence-real-rate-001",
                sourceType: "product_doc",
                title: "actual-package/poster.txt",
                quoteSummary: "최고 연 5.0% 금리를 누구나 받을 수 있는 적금 상품입니다.",
                relevanceScore: 0.91,
                sourceFileId: "file-upload-001"
              }
            ]
          };
        }
      }
    });

    const created = await service.createReviewCaseFromUploadedFiles(requesterContext, {
      title: "실제 업로드 적금 홍보물",
      affiliate: "광주은행",
      productType: "deposit",
      channelType: ["mobile_app"],
      plannedPublishDate: "2026-06-20",
      files: [
        {
          name: "actual-package/poster.txt",
          type: "text/plain",
          size: 73,
          body: new TextEncoder().encode("최고 연 5.0% 금리를 누구나 받을 수 있는 적금 상품입니다.")
        }
      ]
    });

    const analysis = await service.startAnalysis(reviewerContext, created.reviewCase.id);
    const analyzed = await service.getReviewCase(reviewerContext, created.reviewCase.id);

    expect(analysis).toMatchObject({
      status: "analysis_complete",
      issueCount: 3
    });
    expect(analyzed).toMatchObject({
      status: "analysis_complete",
      highestRiskLevel: "high"
    });
    expect(analyzed?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueType: "rate_claim",
          riskLevel: "high",
          title: "최고 금리 표현 조건 확인 필요",
          evidence: [
            expect.objectContaining({
              title: "actual-package/poster.txt",
              quoteSummary: "최고 연 5.0% 금리를 누구나 받을 수 있는 적금 상품입니다."
            })
          ]
        }),
        expect.objectContaining({
          issueType: "absolute_claim",
          riskLevel: "high",
          title: "누구나/무조건 표현 확인 필요"
        }),
        expect.objectContaining({
          issueType: "missing_material",
          riskLevel: "caution",
          title: "필수 심의 자료 누락"
        })
      ])
    );
  });

  it("uses stored upload file text in the default analysis pipeline", async () => {
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      FINPROOF_OCR_PROVIDER: "deterministic",
      FINPROOF_MODEL_PROVIDER: "deterministic"
    };

    try {
      const rootDir = await mkdtemp(path.join(tmpdir(), "finproof-review-service-"));
      const storage = createLocalMetadataStorageAdapter({ rootDir });
      const store = createMockReviewStore([]);
      const service = createReviewService({ store, storage });

      const created = await service.createReviewCaseFromUploadedFiles(requesterContext, {
        title: "실제 텍스트 기반 적금 홍보물",
        affiliate: "광주은행",
        productType: "deposit",
        channelType: ["poster"],
        plannedPublishDate: "2026-06-20",
        files: [
          {
            name: "poster.txt",
            type: "text/plain",
            size: 74,
            body: new TextEncoder().encode("누구나 최고 연 5.0% 금리를 받을 수 있습니다.")
          }
        ]
      });

      await service.startAnalysis(reviewerContext, created.reviewCase.id);

      const job = await service.getLatestAnalysisJob(reviewerContext, created.reviewCase.id);
      const analyzed = await service.getReviewCase(reviewerContext, created.reviewCase.id);

      expect(job?.artifacts?.extractedDocuments).toEqual([
        expect.objectContaining({
          provider: "local-text-extractor",
          text: expect.stringContaining("누구나 최고 연 5.0%")
        })
      ]);
      expect(analyzed?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueType: "absolute_claim",
            evidence: [
              expect.objectContaining({
                quoteSummary: expect.stringContaining("누구나 최고 연 5.0%")
              })
            ]
          })
        ])
      );
    } finally {
      process.env = originalEnv;
    }
  });

  it("adds storage metadata before creating upload-backed review cases", async () => {
    const store = createMockReviewStore();
    const service = createReviewService({ store });

    const result = await service.createReviewCaseFromUploadedFiles(requesterContext, {
      title: "실제 업로드 적금 홍보물",
      affiliate: "광주은행",
      productType: "deposit",
      channelType: ["poster"],
      plannedPublishDate: "2026-06-20",
      files: [
        {
          name: "real-deposit-poster.png",
          type: "image/png",
          size: 2048,
          body: new Uint8Array([1, 2, 3])
        }
      ]
    });

    expect(result.reviewCase.id).toBe("rc-upload-001");
    expect(result.files[0]).toMatchObject({
      id: "file-upload-001",
      storageProvider: "local",
      storageKey: "local/rc-upload-001/file-upload-001/real-deposit-poster.png"
    });
  });

  it("passes uploaded file bytes to the storage adapter", async () => {
    const store = createMockReviewStore();
    const uploadedBody = new Uint8Array([112, 111, 115, 116, 101, 114]);
    const storage: ReviewStorageAdapter = {
      async putReviewFile(input) {
        expect(input.body).toEqual(uploadedBody);

        return {
          storageProvider: "s3",
          storageKey: `s3://finproof-prod-artifacts/reviews/${input.reviewCaseId}/${input.fileId}/${input.fileName}`,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes
        };
      },
      async putKnowledgeDocumentFile(input) {
        return {
          storageProvider: "s3",
          storageKey: `s3://finproof-prod-artifacts/knowledge-documents/${input.documentId}/${input.fileName}`,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes
        };
      },
      async getFileBody() {
        return uploadedBody;
      },
      async getReviewFileBody() {
        return uploadedBody;
      },
      sampleReviewFile(input) {
        return {
          storageProvider: "sample",
          storageKey: `sample/${input.reviewCaseId}/${input.fileName}`,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes
        };
      }
    };
    const service = createReviewService({ store, storage });

    await service.createReviewCaseFromUploadedFiles(requesterContext, {
      title: "실제 업로드 적금 홍보물",
      affiliate: "광주은행",
      productType: "deposit",
      channelType: ["poster"],
      plannedPublishDate: "2026-06-20",
      files: [
        {
          name: "real-deposit-poster.png",
          type: "image/png",
          size: uploadedBody.byteLength,
          body: uploadedBody
        }
      ]
    });
  });

  it("blocks unsafe uploaded files before storage", async () => {
    const store = createMockReviewStore();
    const storage: ReviewStorageAdapter = {
      putReviewFile: vi.fn(),
      putKnowledgeDocumentFile: vi.fn(),
      async getFileBody() {
        return undefined;
      },
      async getReviewFileBody() {
        return undefined;
      },
      sampleReviewFile(input) {
        return {
          storageProvider: "sample",
          storageKey: `sample/${input.reviewCaseId}/${input.fileName}`,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes
        };
      }
    };
    const uploadScanner: UploadScanner = {
      async scanReviewFile(input) {
        throw new UnsafeUploadError({
          fileName: input.fileName,
          scanner: "fixture-scanner",
          signature: "EICAR-Test-File"
        });
      }
    };
    const service = createReviewService({ store, storage, uploadScanner });

    await expect(
      service.createReviewCaseFromUploadedFiles(requesterContext, {
        title: "실제 업로드 적금 홍보물",
        affiliate: "광주은행",
        productType: "deposit",
        channelType: ["poster"],
        plannedPublishDate: "2026-06-20",
        files: [
          {
            name: "infected-poster.png",
            type: "image/png",
            size: 68,
            body: new Uint8Array([69, 73, 67, 65, 82])
          }
        ]
      })
    ).rejects.toThrow("Uploaded file infected-poster.png was rejected by fixture-scanner");
    expect(storage.putReviewFile).not.toHaveBeenCalled();
  });

  it("extracts ZIP package files before creating upload-backed review cases", async () => {
    const store = createMockReviewStore();
    const service = createReviewService({ store });
    const archiveBody = await zipBody({
      "poster.png": "poster",
      "rate-table.csv": "rate,5.0"
    });

    const result = await service.createReviewCaseFromUploadedFiles(requesterContext, {
      title: "압축 패키지 업로드",
      affiliate: "광주은행",
      productType: "deposit",
      channelType: ["poster"],
      plannedPublishDate: "2026-06-20",
      files: [
        {
          name: "review-package.zip",
          type: "application/zip",
          size: archiveBody.byteLength,
          body: archiveBody
        }
      ]
    });

    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "review-package.zip",
          fileType: "package_archive"
        }),
        expect.objectContaining({
          name: "review-package.zip/poster.png",
          fileType: "promotional_creative"
        }),
        expect.objectContaining({
          name: "review-package.zip/rate-table.csv",
          fileType: "rate_table"
        })
      ])
    );
    expect(result.missingMaterials).not.toContain("rate_table");
  });

  it("queues, claims, and completes analysis jobs for workers", async () => {
    const store = createMockReviewStore();
    const created = await store.createReviewCaseFromSamplePackage(reviewerStoreScope, {
      samplePackageId: "rc-demo-deposit-001"
    });

    expect(created).toBeDefined();

    const queued = await store.enqueueAnalysis(reviewerStoreScope, "rc-demo-deposit-001");
    const claimed = await store.claimNextAnalysisJob("tenant-demo", "worker-001");
    const persisted = await store.persistAnalysisOutputs(reviewerStoreScope, {
      reviewCaseId: "rc-demo-deposit-001",
      jobId: claimed!.id,
      artifacts
    });
    const completed = await store.completeAnalysisJob(reviewerStoreScope, claimed!.id, artifacts);
    const latest = await store.getLatestAnalysisJob(reviewerStoreScope, "rc-demo-deposit-001");
    const review = await store.getReviewCase(reviewerStoreScope, "rc-demo-deposit-001");

    expect(queued).toMatchObject({
      status: "analysis_queued",
      jobId: "job-rc-demo-deposit-001-001"
    });
    expect(claimed).toMatchObject({
      id: "job-rc-demo-deposit-001-001",
      status: "running",
      currentStep: "worker_running"
    });
    expect(persisted).toMatchObject({
      issueCount: expect.any(Number),
      evidenceCount: expect.any(Number)
    });
    expect(completed).toMatchObject({
      status: "analysis_complete",
      extractedDocumentCount: 1,
      evidenceCandidateCount: 1
    });
    expect(latest).toMatchObject({
      status: "completed",
      artifacts: expect.objectContaining({
        evidenceCandidates: expect.any(Array)
      })
    });
    expect(review?.status).toBe("analysis_complete");
  });
});
