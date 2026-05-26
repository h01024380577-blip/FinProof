import type { ReviewCase } from "@/domain/types";
import { createReviewAnalysisPipeline } from "./review-analysis-pipeline";

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
});
