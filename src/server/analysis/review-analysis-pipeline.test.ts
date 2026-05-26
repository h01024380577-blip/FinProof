import type { ReviewCase } from "@/domain/types";
import { createReviewAnalysisPipeline } from "./review-analysis-pipeline";
import type { ModelProvider } from "@/server/ai/model-provider";
import type { ReviewStoreScope } from "@/server/reviews";

const review: ReviewCase = {
  id: "rc-upload-001",
  title: "실제 업로드 적금 홍보물",
  affiliate: "광주은행",
  productType: "deposit",
  channelType: ["poster"],
  plannedPublishDate: "2026-06-20",
  status: "analysis_waiting",
  highestRiskLevel: "info",
  requester: "업로드 요청자",
  reviewer: "준법심의자",
  promotionalCopy: "최고 연 5.0% 우대금리",
  disclosure: "조건 충족 시 적용",
  productDescription: "우대금리는 급여이체 조건 충족 시 제공됩니다.",
  missingMaterials: [],
  files: [
    {
      id: "file-upload-001",
      name: "poster.png",
      fileType: "promotional_creative",
      classificationConfidence: 0.78,
      parseStatus: "pending",
      storageProvider: "s3",
      storageKey: "s3://finproof-s3/reviews/rc-upload-001/file-upload-001/poster.png",
      contentType: "image/png",
      sizeBytes: 1024
    }
  ],
  issues: [],
  expectedDraft: "검토 필요"
};

describe("review analysis pipeline", () => {
  it("extracts OCR text and creates RAG evidence candidates", async () => {
    const pipeline = createReviewAnalysisPipeline({
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "최고 연 5.0% 우대금리는 급여이체 조건 충족 시 제공됩니다.",
            confidence: 0.91,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    const artifacts = await pipeline.run({ review });

    expect(artifacts.extractedDocuments).toEqual([
      expect.objectContaining({
        fileId: "file-upload-001",
        text: expect.stringContaining("급여이체 조건"),
        confidence: 0.91,
        provider: "fixture-ocr"
      })
    ]);
    expect(artifacts.evidenceCandidates).toEqual([
      expect.objectContaining({
        id: "evidence-candidate-file-upload-001-001",
        sourceType: "product_doc",
        title: "poster.png",
        quoteSummary: expect.stringContaining("급여이체 조건"),
        relevanceScore: expect.any(Number)
      })
    ]);
  });

  it("extracts text from stored upload bodies before retrieval", async () => {
    const pipeline = createReviewAnalysisPipeline({
      fileBodyReader: {
        async getReviewFileBody(storageKey) {
          expect(storageKey).toBe("local/rc-upload-001/file-upload-001/poster.html");

          return new TextEncoder().encode(
            "<main><h1>누구나 최고 연 5.0%</h1><p>급여이체 등 우대 조건 충족 시 적용됩니다.</p></main>"
          );
        }
      }
    });

    const artifacts = await pipeline.run({
      review: {
        ...review,
        files: [
          {
            ...review.files[0],
            name: "poster.html",
            storageProvider: "local",
            storageKey: "local/rc-upload-001/file-upload-001/poster.html",
            contentType: "text/html"
          }
        ]
      }
    });

    expect(artifacts.extractedDocuments).toEqual([
      expect.objectContaining({
        fileName: "poster.html",
        provider: "local-text-extractor",
        text: expect.stringContaining("누구나 최고 연 5.0%"),
        confidence: 0.96
      })
    ]);
    expect(artifacts.evidenceCandidates[0]).toEqual(
      expect.objectContaining({
        quoteSummary: expect.stringContaining("우대 조건 충족")
      })
    );
  });

  it("prioritizes extracted document text over metadata-only archive entries", async () => {
    const pipeline = createReviewAnalysisPipeline({
      ocrProvider: {
        async extract() {
          return [
            {
              fileId: "file-upload-001",
              fileName: "package.zip",
              text: "파일명: package.zip 본문 추출 대상이 아닙니다.",
              confidence: 0.62,
              provider: "metadata-only"
            },
            {
              fileId: "file-upload-002",
              fileName: "poster.txt",
              text: "누구나 받을 수 있는 최고 연 5.0% 적금. 우대 조건 충족 시 적용됩니다.",
              confidence: 0.96,
              provider: "local-text-extractor"
            }
          ];
        }
      }
    });

    const artifacts = await pipeline.run({ review });

    expect(artifacts.evidenceCandidates[0]).toEqual(
      expect.objectContaining({
        title: "poster.txt",
        quoteSummary: expect.stringContaining("최고 연 5.0%")
      })
    );
  });

  it("retrieves approved knowledge evidence and reranks every RAG candidate", async () => {
    const scope: ReviewStoreScope = {
      tenantId: "tenant-demo",
      actorUserId: "user-reviewer-demo",
      actorRole: "reviewer"
    };
    const searchKnowledgeEvidence = vi.fn(async () => [
      {
        id: "knowledge-evidence-001",
        sourceType: "internal_policy" as const,
        documentId: "knowledge-001",
        chunkId: "chunk-knowledge-001-001",
        title: "예금 광고 심의 지침",
        version: "2026.05",
        effectiveFrom: "2026-05-01",
        quoteSummary: "최고 금리 표현은 우대 조건과 한도를 같은 화면에 표시해야 합니다.",
        relevanceScore: 0.88
      }
    ]);
    const rerank = vi.fn(async ({ candidates }) =>
      [...candidates].sort((left, right) =>
        left.sourceType === "internal_policy" ? -1 : right.sourceType === "internal_policy" ? 1 : 0
      )
    );
    const pipeline = createReviewAnalysisPipeline({
      reviewStore: { searchKnowledgeEvidence },
      reranker: {
        provider: "fixture-reranker",
        rerank
      },
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "누구나 최고 연 5.0% 우대 조건 충족 시 적용됩니다.",
            confidence: 0.94,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    const artifacts = await pipeline.run({ review, scope });

    expect(searchKnowledgeEvidence).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        query: expect.stringContaining("최고 연 5.0%"),
        productType: "deposit",
        topK: expect.any(Number)
      })
    );
    expect(rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("최고 연 5.0%"),
        candidates: expect.arrayContaining([
          expect.objectContaining({ sourceType: "product_doc" }),
          expect.objectContaining({ sourceType: "internal_policy" })
        ])
      })
    );
    expect(artifacts.evidenceCandidates[0]).toMatchObject({
      sourceType: "internal_policy",
      chunkId: "chunk-knowledge-001-001"
    });
  });

  it("runs model-backed review subagents and stores their findings", async () => {
    const provider: ModelProvider = {
      generateText: vi
        .fn()
        .mockResolvedValueOnce({
          provider: "openai",
          model: "gpt-5.2",
          text: JSON.stringify([
            {
              title: "최고 금리 조건 병기 필요",
              riskLevel: "high",
              targetText: "누구나 최고 연 5.0%",
              description: "절대 표현과 최고 금리 표현이 함께 있어 조건 고지가 필요합니다.",
              suggestedAction: "change_request",
              suggestedCopy: "최고 연 5.0%는 우대 조건 충족 시 적용됩니다.",
              evidenceCandidateIds: ["evidence-candidate-file-upload-001-001"],
              confidence: 0.88
            }
          ])
        })
        .mockResolvedValue({
          provider: "openai",
          model: "gpt-5.2",
          text: "[]"
        })
    };
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "누구나 최고 연 5.0% 우대 조건 충족 시 적용됩니다.",
            confidence: 0.94,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    const artifacts = await pipeline.run({ review });

    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "creative_review",
        routeContext: expect.objectContaining({
          riskLevel: "info"
        })
      })
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "product_terms"
      })
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "evidence_verification"
      })
    );
    expect(artifacts.agentFindings).toEqual([
      expect.objectContaining({
        agent: "creative_review",
        title: "최고 금리 조건 병기 필요",
        evidenceCandidateIds: ["evidence-candidate-file-upload-001-001"]
      })
    ]);
  });
});
