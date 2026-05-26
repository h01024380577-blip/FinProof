import type {
  AgentType,
  Evidence,
  ReviewCase,
  ReviewFile,
  ReviewIssue,
  RiskLevel
} from "@/domain/types";
import { createModelProvider, type ModelProvider } from "@/server/ai/model-provider";
import {
  createEmbeddingProvider,
  type EmbeddingProvider
} from "@/server/knowledge/embedding-provider";
import type { ReviewStore, ReviewStoreScope } from "@/server/reviews";
import { getReviewStorageAdapter, type ReviewStorageAdapter } from "@/server/storage";
import { buildAnalysisIssues } from "./issue-generation";
import { getAnalysisProviderConfig } from "./provider-config";
import { createReranker, type Reranker } from "./rerank-provider";
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

export type AgentFindingCandidate = {
  agentType: AgentType;
  issueType: string;
  riskLevel: RiskLevel;
  title: string;
  targetText: string;
  targetBbox: [number, number, number, number];
  description: string;
  suggestedAction: ReviewIssue["suggestedAction"];
  suggestedCopy: string;
  confidence: number;
  evidence: RagEvidenceCandidate[];
};

export type AnalysisArtifacts = {
  generatedAt: string;
  extractedDocuments: ExtractedDocument[];
  evidenceCandidates: RagEvidenceCandidate[];
  agentFindings?: AgentFinding[];
  findings?: AgentFindingCandidate[];
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
  scope?: ReviewStoreScope;
};

export type RagRetriever = {
  retrieve(input: RagRetrieveInput): Promise<RagEvidenceCandidate[]>;
};

export type ReviewFileBodyReader = Pick<ReviewStorageAdapter, "getReviewFileBody">;

export type ReviewAnalysisPipeline = {
  run(input: { review: ReviewCase; scope?: ReviewStoreScope }): Promise<AnalysisArtifacts>;
};

type ReviewAnalysisPipelineOptions = {
  ocrProvider?: OcrProvider;
  ragRetriever?: RagRetriever;
  reviewStore?: Pick<ReviewStore, "searchKnowledgeEvidence">;
  reranker?: Reranker;
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

function reviewRagQuery(review: ReviewCase): string {
  return [review.promotionalCopy, review.disclosure, review.productDescription].join(" ");
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
  const text =
    file.contentType?.toLowerCase().includes("html") || /\.html?$/i.test(file.name)
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
  env: Record<string, string | undefined> = process.env,
  reviewStore?: Pick<ReviewStore, "searchKnowledgeEvidence">,
  embeddingProvider: EmbeddingProvider = createEmbeddingProvider(env)
): RagRetriever {
  const config = getAnalysisProviderConfig(env);

  return {
    async retrieve({ review, extractedDocuments, scope }) {
      const query = reviewRagQuery(review);
      const searchableDocuments = extractedDocuments.some(
        (document) => document.provider !== "metadata-only" && document.text.trim().length > 0
      )
        ? extractedDocuments.filter((document) => document.provider !== "metadata-only")
        : extractedDocuments;

      const productDocumentCandidates = searchableDocuments
        .map((document, index) => ({
          id: `evidence-candidate-${document.fileId}-${String(index + 1).padStart(3, "0")}`,
          sourceType: "product_doc" as const,
          title: document.fileName,
          quoteSummary: textPreview(document.text, config.rag.maxContextChars),
          relevanceScore: overlapScore(query, document.text),
          sourceFileId: document.fileId
        }))
        .filter((candidate) => candidate.relevanceScore >= config.rag.minScore)
        .sort((left, right) => right.relevanceScore - left.relevanceScore);
      const queryEmbedding =
        reviewStore && scope ? (await embeddingProvider.embed([query]))[0] : undefined;
      const knowledgeCandidates =
        reviewStore && scope
          ? await reviewStore.searchKnowledgeEvidence(scope, {
              query,
              productType: review.productType,
              topK: config.rag.topK * 2,
              minScore: config.rag.minScore,
              queryEmbedding
            })
          : [];

      return [...productDocumentCandidates, ...knowledgeCandidates];
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

function agentTypeForIssue(issue: ReviewIssue): AgentType {
  const [sourceAgent] = issue.sourceAgents;

  if (sourceAgent === "creative_review") {
    return "creative";
  }

  if (
    sourceAgent === "main" ||
    sourceAgent === "creative" ||
    sourceAgent === "product_terms" ||
    sourceAgent === "regulation" ||
    sourceAgent === "internal_policy" ||
    sourceAgent === "case_search"
  ) {
    return sourceAgent;
  }

  return "main";
}

function issueToFinding(issue: ReviewIssue): AgentFindingCandidate {
  return {
    agentType: agentTypeForIssue(issue),
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    title: issue.title,
    targetText: issue.targetText,
    targetBbox: issue.targetBbox,
    description: issue.description,
    suggestedAction: issue.suggestedAction,
    suggestedCopy: issue.suggestedCopy,
    confidence: issue.confidence ?? 0.86,
    evidence: issue.evidence
  };
}

export function createReviewAnalysisPipeline({
  fileBodyReader = defaultFileBodyReader(),
  ocrProvider = defaultOcrProvider(fileBodyReader),
  reviewStore,
  ragRetriever = createLexicalRagRetriever(process.env, reviewStore),
  reranker = createReranker(),
  modelProvider = createModelProvider(),
  subAgentOrchestrator = createReviewSubAgentOrchestrator(modelProvider),
  now = () => new Date()
}: ReviewAnalysisPipelineOptions = {}): ReviewAnalysisPipeline {
  return {
    async run({ review, scope }) {
      const config = getAnalysisProviderConfig();
      const query = reviewRagQuery(review);
      const extractedDocuments = await ocrProvider.extract({ review, files: review.files });
      const retrievedCandidates = await ragRetriever.retrieve({
        review,
        extractedDocuments,
        scope
      });
      const evidenceCandidates = (
        await reranker.rerank({
          query,
          candidates: retrievedCandidates
        })
      ).slice(0, config.rerank.topK);
      const agentFindings = await subAgentOrchestrator.run({
        review,
        extractedDocuments,
        evidenceCandidates
      });
      const artifacts = {
        generatedAt: now().toISOString(),
        extractedDocuments,
        evidenceCandidates,
        ...(agentFindings.length > 0 ? { agentFindings } : {})
      };
      const findings = buildAnalysisIssues(review, artifacts).map(issueToFinding);

      return {
        ...artifacts,
        findings,
        ...(agentFindings.length > 0 ? { agentFindings } : {})
      };
    }
  };
}
