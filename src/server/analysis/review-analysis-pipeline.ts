import type { Evidence, ReviewCase, ReviewFile } from "@/domain/types";
import { createModelProvider, type ModelProvider } from "@/server/ai/model-provider";
import { getReviewStorageAdapter, type ReviewStorageAdapter } from "@/server/storage";
import { getAnalysisProviderConfig } from "./provider-config";
import {
  createReviewSubAgentOrchestrator,
  type AgentFinding,
  type ReviewSubAgentOrchestrator
} from "./review-subagents";

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
  agentFindings?: AgentFinding[];
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

export type ReviewFileBodyReader = Pick<ReviewStorageAdapter, "getReviewFileBody">;

export type ReviewAnalysisPipeline = {
  run(input: { review: ReviewCase }): Promise<AnalysisArtifacts>;
};

type ReviewAnalysisPipelineOptions = {
  ocrProvider?: OcrProvider;
  ragRetriever?: RagRetriever;
  fileBodyReader?: ReviewFileBodyReader;
  modelProvider?: ModelProvider;
  subAgentOrchestrator?: ReviewSubAgentOrchestrator;
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

function isTextLikeFile(file: ReviewFile) {
  const contentType = file.contentType?.toLowerCase() ?? "";
  const fileName = file.name.toLowerCase();

  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("csv") ||
    contentType.includes("html") ||
    contentType.includes("xml") ||
    /\.(txt|csv|html|htm|md|json|xml)$/i.test(fileName)
  );
}

function stripHtml(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeStoredText(file: ReviewFile, body: Uint8Array) {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(body);
  const text = file.contentType?.toLowerCase().includes("html") || /\.html?$/i.test(file.name)
    ? stripHtml(decoded)
    : decoded.replace(/\s+/g, " ").trim();

  return text.length > 0 ? text : undefined;
}

function metadataOnlyText(file: ReviewFile) {
  return [
    `파일명: ${file.name}`,
    "이 파일은 현재 로컬 텍스트 추출 대상이 아니거나 저장 본문을 읽을 수 없습니다.",
    "텍스트, HTML, CSV, JSON, Markdown 파일은 업로드 본문 기반으로 분석됩니다."
  ].join("\n");
}

async function extractStoredText(file: ReviewFile, fileBodyReader?: ReviewFileBodyReader) {
  if (!file.storageKey || !fileBodyReader || !isTextLikeFile(file)) {
    return undefined;
  }

  const body = await fileBodyReader.getReviewFileBody(file.storageKey);

  return body ? decodeStoredText(file, body) : undefined;
}

function createDeterministicOcrProvider(fileBodyReader?: ReviewFileBodyReader): OcrProvider {
  return {
    async extract({ review, files }) {
      return Promise.all(
        files.map(async (file) => {
          const storedText = await extractStoredText(file, fileBodyReader);

          if (storedText) {
            return {
              fileId: file.id,
              fileName: file.name,
              storageKey: file.storageKey,
              text: storedText,
              confidence: 0.96,
              provider: "local-text-extractor"
            };
          }

          const isSampleFile = file.storageProvider === "sample";

          return {
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: isSampleFile
              ? [
                  review.promotionalCopy,
                  review.disclosure,
                  review.productDescription,
                  `파일명: ${file.name}`
                ].join("\n")
              : metadataOnlyText(file),
            confidence: isSampleFile
              ? Math.min(0.97, Math.max(0.72, file.classificationConfidence))
              : Math.min(0.68, Math.max(0.45, file.classificationConfidence)),
            provider: isSampleFile ? "deterministic-sample" : "metadata-only"
          };
        })
      );
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
      const searchableDocuments = extractedDocuments.some(
        (document) => document.provider !== "metadata-only" && document.text.trim().length > 0
      )
        ? extractedDocuments.filter((document) => document.provider !== "metadata-only")
        : extractedDocuments;

      return searchableDocuments
        .map((document, index) => ({
          id: `evidence-candidate-${document.fileId}-${String(index + 1).padStart(3, "0")}`,
          sourceType: "product_doc" as const,
          title: document.fileName,
          quoteSummary: textPreview(document.text, config.rag.maxContextChars),
          relevanceScore: overlapScore(query, document.text),
          sourceFileId: document.fileId
        }))
        .filter((candidate) => candidate.relevanceScore >= config.rag.minScore)
        .sort((left, right) => right.relevanceScore - left.relevanceScore)
        .slice(0, config.rag.topK);
    }
  };
}

function defaultFileBodyReader(): ReviewFileBodyReader {
  return getReviewStorageAdapter();
}

function defaultOcrProvider(fileBodyReader?: ReviewFileBodyReader) {
  const config = getAnalysisProviderConfig();

  return config.ocr.provider === "http"
    ? createHttpOcrProvider()
    : createDeterministicOcrProvider(fileBodyReader);
}

export function createReviewAnalysisPipeline({
  fileBodyReader = defaultFileBodyReader(),
  ocrProvider = defaultOcrProvider(fileBodyReader),
  ragRetriever = createLexicalRagRetriever(),
  modelProvider = createModelProvider(),
  subAgentOrchestrator = createReviewSubAgentOrchestrator(modelProvider),
  now = () => new Date()
}: ReviewAnalysisPipelineOptions = {}): ReviewAnalysisPipeline {
  return {
    async run({ review }) {
      const extractedDocuments = await ocrProvider.extract({ review, files: review.files });
      const evidenceCandidates = await ragRetriever.retrieve({ review, extractedDocuments });
      const agentFindings = await subAgentOrchestrator.run({
        review,
        extractedDocuments,
        evidenceCandidates
      });

      return {
        generatedAt: now().toISOString(),
        extractedDocuments,
        evidenceCandidates,
        ...(agentFindings.length > 0 ? { agentFindings } : {})
      };
    }
  };
}
