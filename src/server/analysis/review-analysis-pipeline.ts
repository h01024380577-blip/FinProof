import type { Evidence, ReviewCase, ReviewFile } from "@/domain/types";
import { getAnalysisProviderConfig } from "./provider-config";

export type ExtractedDocument = {
  fileId: string;
  fileName: string;
  storageKey?: string;
  text: string;
  confidence: number;
  provider: string;
};

export type RagEvidenceCandidate = Evidence & {
  sourceFileId?: string;
};

export type AnalysisArtifacts = {
  generatedAt: string;
  extractedDocuments: ExtractedDocument[];
  evidenceCandidates: RagEvidenceCandidate[];
};

type OcrExtractInput = {
  review: ReviewCase;
  files: ReviewFile[];
};

export type OcrProvider = {
  extract(input: OcrExtractInput): Promise<ExtractedDocument[]>;
};

type RagRetrieveInput = {
  review: ReviewCase;
  extractedDocuments: ExtractedDocument[];
};

export type RagRetriever = {
  retrieve(input: RagRetrieveInput): Promise<RagEvidenceCandidate[]>;
};

export type ReviewAnalysisPipeline = {
  run(input: { review: ReviewCase }): Promise<AnalysisArtifacts>;
};

type ReviewAnalysisPipelineOptions = {
  ocrProvider?: OcrProvider;
  ragRetriever?: RagRetriever;
  now?: () => Date;
};

function textPreview(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function overlapScore(query: string, text: string) {
  const terms = query
    .split(/[\s.,:;!?()[\]{}"'`~|\\/]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  if (terms.length === 0) {
    return 0.72;
  }

  const matches = terms.filter((term) => text.includes(term)).length;

  return Math.max(0.72, Math.min(0.98, 0.72 + matches / terms.length / 4));
}

function createDeterministicOcrProvider(): OcrProvider {
  return {
    async extract({ review, files }) {
      return files.map((file) => ({
        fileId: file.id,
        fileName: file.name,
        storageKey: file.storageKey,
        text: [
          review.promotionalCopy,
          review.disclosure,
          review.productDescription,
          `파일명: ${file.name}`
        ].join("\n"),
        confidence: Math.min(0.97, Math.max(0.72, file.classificationConfidence)),
        provider: "deterministic"
      }));
    }
  };
}

function createHttpOcrProvider(env: Record<string, string | undefined> = process.env): OcrProvider {
  return {
    async extract({ review, files }) {
      const endpoint = env.FINPROOF_OCR_ENDPOINT?.trim();

      if (!endpoint) {
        throw new Error("FINPROOF_OCR_ENDPOINT is required when FINPROOF_OCR_PROVIDER=http");
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(env.FINPROOF_OCR_API_KEY
            ? { authorization: `Bearer ${env.FINPROOF_OCR_API_KEY}` }
            : {})
        },
        body: JSON.stringify({
          reviewCaseId: review.id,
          files: files.map((file) => ({
            id: file.id,
            name: file.name,
            storageKey: file.storageKey,
            contentType: file.contentType
          }))
        })
      });

      if (!response.ok) {
        throw new Error(`OCR provider failed with ${response.status}`);
      }

      const body = (await response.json()) as { documents?: ExtractedDocument[] };

      return body.documents ?? [];
    }
  };
}

function createLexicalRagRetriever(
  env: Record<string, string | undefined> = process.env
): RagRetriever {
  const config = getAnalysisProviderConfig(env);

  return {
    async retrieve({ review, extractedDocuments }) {
      const query = [review.promotionalCopy, review.disclosure, review.productDescription].join(
        " "
      );

      return extractedDocuments
        .slice(0, config.rag.topK)
        .map((document, index) => ({
          id: `evidence-candidate-${document.fileId}-${String(index + 1).padStart(3, "0")}`,
          sourceType: "product_doc" as const,
          title: document.fileName,
          quoteSummary: textPreview(document.text, config.rag.maxContextChars),
          relevanceScore: overlapScore(query, document.text),
          sourceFileId: document.fileId
        }))
        .filter((candidate) => candidate.relevanceScore >= config.rag.minScore);
    }
  };
}

function defaultOcrProvider() {
  const config = getAnalysisProviderConfig();

  return config.ocr.provider === "http"
    ? createHttpOcrProvider()
    : createDeterministicOcrProvider();
}

export function createReviewAnalysisPipeline({
  ocrProvider = defaultOcrProvider(),
  ragRetriever = createLexicalRagRetriever(),
  now = () => new Date()
}: ReviewAnalysisPipelineOptions = {}): ReviewAnalysisPipeline {
  return {
    async run({ review }) {
      const extractedDocuments = await ocrProvider.extract({ review, files: review.files });
      const evidenceCandidates = await ragRetriever.retrieve({ review, extractedDocuments });

      return {
        generatedAt: now().toISOString(),
        extractedDocuments,
        evidenceCandidates
      };
    }
  };
}
