import type {
  AgentType,
  Evidence,
  ReviewCase,
  ReviewFile,
  ReviewIssue,
  RiskLevel
} from "@/domain/types";
import {
  createModelProvider,
  extractGeminiText,
  type ModelProvider
} from "@/server/ai/model-provider";
import {
  createEmbeddingProvider,
  type EmbeddingProvider
} from "@/server/knowledge/embedding-provider";
import type { ReviewStore, ReviewStoreScope } from "@/server/reviews";
import { getReviewStorageAdapter, type ReviewStorageAdapter } from "@/server/storage";
import { buildAnalysisIssues } from "./issue-generation";
import {
  segmentMultilingualDocuments,
  type KoreanComplianceMapping,
  type LocalizedRiskFinding,
  type MultilingualAgentError,
  type MultilingualSegment
} from "./multilingual";
import { runMultilingualRiskTeam } from "./multilingual-risk-team";
import { getAnalysisProviderConfig } from "./provider-config";
import { createReranker, type Reranker } from "./rerank-provider";
import {
  createReviewSubAgentOrchestrator,
  type AgentFinding,
  type ReviewSubAgentOrchestrator
} from "./review-subagents";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
  localizedRiskFinding?: LocalizedRiskFinding;
  koreanComplianceMapping?: KoreanComplianceMapping;
};

export type AnalysisArtifacts = {
  generatedAt: string;
  extractedDocuments: ExtractedDocument[];
  evidenceCandidates: RagEvidenceCandidate[];
  agentFindings?: AgentFinding[];
  findings?: AgentFindingCandidate[];
  multilingualSegments?: MultilingualSegment[];
  localizedRiskFindings?: LocalizedRiskFinding[];
  koreanComplianceMappings?: KoreanComplianceMapping[];
  multilingualAgentErrors?: MultilingualAgentError[];
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
  prefetch?(input: { review: ReviewCase; scope?: ReviewStoreScope }): Promise<void>;
};

export type ReviewFileBodyReader = Pick<ReviewStorageAdapter, "getReviewFileBody">;

export type ReviewAnalysisPipeline = {
  run(input: { review: ReviewCase; scope?: ReviewStoreScope }): Promise<AnalysisArtifacts>;
};

type OcrFetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

type ReviewAnalysisPipelineOptions = {
  ocrProvider?: OcrProvider;
  ragRetriever?: RagRetriever;
  reviewStore?: Pick<ReviewStore, "searchKnowledgeEvidence"> &
    Partial<Pick<ReviewStore, "searchCaseHistoryEvidence">>;
  reranker?: Reranker;
  fileBodyReader?: ReviewFileBodyReader;
  modelProvider?: ModelProvider;
  subAgentOrchestrator?: ReviewSubAgentOrchestrator;
  now?: () => Date;
};

const execFileAsync = promisify(execFile);
const DEFAULT_MIN_PDF_TEXT_CHARS = 40;

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

function isPdfFile(file: ReviewFile) {
  const contentType = file.contentType?.split(";")[0]?.trim().toLowerCase();

  return contentType === "application/pdf" || /\.pdf$/i.test(file.name);
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

async function extractPdfText(body: Uint8Array) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "finproof-pdf-"));
  const pdfPath = path.join(tempDir, "input.pdf");
  const pdfToTextPath = process.env.FINPROOF_PDFTOTEXT_PATH?.trim() || "/usr/bin/pdftotext";

  try {
    await writeFile(pdfPath, body);
    const { stdout } = await execFileAsync(pdfToTextPath, [pdfPath, "-"], {
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024
    });
    const text = String(stdout).replace(/\s+/g, " ").trim();

    return text.length > 0 ? text : undefined;
  } catch (error) {
    console.log(`[PDFTextExtractor] unavailable or failed: ${errorMessage(error)}`);

    return undefined;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function minPdfTextChars() {
  const parsed = Number(process.env.FINPROOF_PDF_TEXT_MIN_CHARS?.trim());

  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : DEFAULT_MIN_PDF_TEXT_CHARS;
}

function hasEnoughPdfText(text: string) {
  return text.replace(/\s+/g, "").length >= minPdfTextChars();
}

function metadataOnlyText(file: ReviewFile) {
  return [
    `파일명: ${file.name}`,
    "이 파일은 현재 로컬 텍스트 추출 대상이 아니거나 저장 본문을 읽을 수 없습니다.",
    "텍스트, HTML, CSV, JSON, Markdown 파일은 업로드 본문 기반으로 분석됩니다."
  ].join("\n");
}

function sampleFileText(review: ReviewCase, file: ReviewFile) {
  return [
    review.promotionalCopy,
    review.disclosure,
    review.productDescription,
    `파일명: ${file.name}`
  ].join("\n");
}

function sampleOrMetadataDocument(review: ReviewCase, file: ReviewFile): ExtractedDocument {
  const isSampleFile = file.storageProvider === "sample";

  return {
    fileId: file.id,
    fileName: file.name,
    storageKey: file.storageKey,
    text: isSampleFile ? sampleFileText(review, file) : metadataOnlyText(file),
    confidence: isSampleFile
      ? Math.min(0.97, Math.max(0.72, file.classificationConfidence))
      : Math.min(0.68, Math.max(0.45, file.classificationConfidence)),
    provider: isSampleFile ? "deterministic-sample" : "metadata-only"
  };
}

async function extractStoredDocument(file: ReviewFile, fileBodyReader?: ReviewFileBodyReader) {
  if (!file.storageKey || !fileBodyReader || (!isTextLikeFile(file) && !isPdfFile(file))) {
    return undefined;
  }

  const body = await fileBodyReader.getReviewFileBody(file.storageKey);

  if (!body) {
    return undefined;
  }

  if (isTextLikeFile(file)) {
    const text = decodeStoredText(file, body);

    return text
      ? {
          text,
          provider: "local-text-extractor",
          confidence: 0.96
        }
      : undefined;
  }

  const pdfText = await extractPdfText(body);

  return pdfText && hasEnoughPdfText(pdfText)
    ? {
        text: pdfText,
        provider: "local-pdf-text-extractor",
        confidence: 0.94
      }
    : undefined;
}

function documentsForAnalysis(documents: ExtractedDocument[]) {
  const extracted = documents.filter(
    (document) => document.provider !== "metadata-only" && document.text.trim().length > 0
  );

  return extracted.length > 0 ? extracted : documents;
}

function createDeterministicOcrProvider(fileBodyReader?: ReviewFileBodyReader): OcrProvider {
  return {
    async extract({ review, files }) {
      return Promise.all(
        files.map(async (file) => {
          const storedDocument = await extractStoredDocument(file, fileBodyReader);

          if (storedDocument) {
            return {
              fileId: file.id,
              fileName: file.name,
              storageKey: file.storageKey,
              text: storedDocument.text,
              confidence: storedDocument.confidence,
              provider: storedDocument.provider
            };
          }

          return sampleOrMetadataDocument(review, file);
        })
      );
    }
  };
}

function geminiOcrMimeType(file: ReviewFile): string | undefined {
  const contentType = file.contentType?.split(";")[0]?.trim().toLowerCase();

  if (contentType === "application/pdf" || contentType?.startsWith("image/")) {
    return contentType;
  }

  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".pdf")) {
    return "application/pdf";
  }

  const imageExtensions: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif"
  };
  const extension = Object.keys(imageExtensions).find((candidate) => fileName.endsWith(candidate));

  return extension ? imageExtensions[extension] : undefined;
}

function positiveInteger(env: Record<string, string | undefined>, key: string, fallback: number) {
  const raw = env[key]?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clampConfidence(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0.45, Math.min(0.99, value));
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(candidate);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseGeminiOcrText(rawText: string) {
  const parsed = parseJsonObject(rawText);

  if (parsed && typeof parsed.text === "string") {
    return {
      text: parsed.text.replace(/\s+/g, " ").trim(),
      confidence: clampConfidence(parsed.confidence, 0.82)
    };
  }

  return {
    text: rawText.replace(/\s+/g, " ").trim(),
    confidence: 0.78
  };
}

function geminiOcrSystemInstruction() {
  return [
    "당신은 금융 광고 심의용 OCR 엔진입니다.",
    "첨부된 PDF 또는 이미지에서 실제로 보이는 텍스트만 추출하세요.",
    "보이지 않는 문구, 법령 해석, 요약, 추론은 절대 추가하지 마세요.",
    "표와 줄바꿈은 의미가 보존되도록 평문으로 정리하세요.",
    '응답은 반드시 JSON 객체 하나로만 작성하세요: {"text":"추출 텍스트","confidence":0.0}'
  ].join("\n");
}

function geminiOcrUserPrompt(review: ReviewCase, file: ReviewFile) {
  return [
    `심의 ID: ${review.id}`,
    `파일명: ${file.name}`,
    `상품군: ${review.productType}`,
    "이 파일에서 심의에 사용할 수 있는 화면/문서 텍스트를 OCR로 추출하세요."
  ].join("\n");
}

export function createGeminiOcrProvider(
  env: Record<string, string | undefined> = process.env,
  fileBodyReader?: ReviewFileBodyReader,
  fetchImpl: OcrFetchLike = fetch
): OcrProvider {
  return {
    async extract({ review, files }) {
      const apiKey = env.GEMINI_API_KEY?.trim();

      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is required when FINPROOF_OCR_PROVIDER=gemini");
      }

      const model = env.FINPROOF_OCR_MODEL?.trim() || "gemini-2.5-flash-lite";
      const maxInlineBytes = positiveInteger(
        env,
        "FINPROOF_OCR_MAX_INLINE_BYTES",
        20 * 1024 * 1024
      );
      const ocrTimeoutMs = positiveInteger(env, "FINPROOF_OCR_TIMEOUT_MS", 90_000);

      return Promise.all(
        files.map(async (file) => {
          const storedDocument = await extractStoredDocument(file, fileBodyReader);

          if (storedDocument) {
            return {
              fileId: file.id,
              fileName: file.name,
              storageKey: file.storageKey,
              text: storedDocument.text,
              confidence: storedDocument.confidence,
              provider: storedDocument.provider
            };
          }

          const mimeType = geminiOcrMimeType(file);

          if (!mimeType || !file.storageKey || !fileBodyReader) {
            return sampleOrMetadataDocument(review, file);
          }

          const body = await fileBodyReader.getReviewFileBody(file.storageKey);

          if (!body || body.byteLength > maxInlineBytes) {
            return sampleOrMetadataDocument(review, file);
          }

          const response = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",
              signal: AbortSignal.timeout(ocrTimeoutMs),
              headers: {
                "content-type": "application/json",
                "x-goog-api-key": apiKey
              },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [{ text: geminiOcrSystemInstruction() }]
                },
                contents: [
                  {
                    role: "user",
                    parts: [
                      { text: geminiOcrUserPrompt(review, file) },
                      {
                        inlineData: {
                          mimeType,
                          data: Buffer.from(body).toString("base64")
                        }
                      }
                    ]
                  }
                ],
                generationConfig: {
                  temperature: 0
                }
              })
            }
          );

          if (!response.ok) {
            const errBody = await response.text().catch(() => "");
            console.log(`[GeminiOCR] API error ${response.status}: ${errBody.slice(0, 200)}`);
            throw new Error(
              `Gemini OCR request failed: ${response.status ?? "unknown"} ${
                response.statusText ?? ""
              }`.trim()
            );
          }

          const rawJson = await response.json();
          const extracted = parseGeminiOcrText(extractGeminiText(rawJson));

          if (!extracted.text) {
            return sampleOrMetadataDocument(review, file);
          }

          return {
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: extracted.text,
            confidence: extracted.confidence,
            provider: "gemini-ocr"
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
  reviewStore?: Pick<ReviewStore, "searchKnowledgeEvidence"> &
    Partial<Pick<ReviewStore, "searchCaseHistoryEvidence">>,
  embeddingProvider: EmbeddingProvider = createEmbeddingProvider(env)
): RagRetriever {
  const config = getAnalysisProviderConfig(env);
  let cachedKnowledgeCaseCandidates: RagEvidenceCandidate[] | undefined;

  async function fetchKnowledgeCaseCandidates(
    review: ReviewCase,
    scope: ReviewStoreScope | undefined,
    query: string
  ): Promise<RagEvidenceCandidate[]> {
    const queryEmbedding =
      reviewStore && scope ? (await embeddingProvider.embed([query]))[0] : undefined;
    const [knowledgeCandidates, caseHistoryCandidates] = await Promise.all([
      reviewStore && scope
        ? reviewStore.searchKnowledgeEvidence(scope, {
            query,
            productType: review.productType,
            topK: config.rag.topK * 2,
            minScore: config.rag.minScore,
            queryEmbedding
          })
        : Promise.resolve([]),
      reviewStore?.searchCaseHistoryEvidence && scope
        ? reviewStore.searchCaseHistoryEvidence(scope, {
            query,
            productType: review.productType,
            topK: config.rag.topK,
            minScore: config.rag.minScore,
            queryEmbedding,
            excludeReviewCaseId: review.id
          })
        : Promise.resolve([])
    ]);

    return [...knowledgeCandidates, ...caseHistoryCandidates];
  }

  return {
    async prefetch({ review, scope }) {
      const query = reviewRagQuery(review);
      cachedKnowledgeCaseCandidates = await fetchKnowledgeCaseCandidates(review, scope, query);
    },

    async retrieve({ review, extractedDocuments, scope }) {
      const query = reviewRagQuery(review);
      const searchableDocuments = documentsForAnalysis(extractedDocuments);

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

      // Use candidates prefetched in parallel with OCR if available, otherwise fetch now
      const knowledgeCaseCandidates =
        cachedKnowledgeCaseCandidates ??
        (await fetchKnowledgeCaseCandidates(review, scope, query));
      cachedKnowledgeCaseCandidates = undefined;

      return [...productDocumentCandidates, ...knowledgeCaseCandidates];
    }
  };
}

function defaultFileBodyReader(): ReviewFileBodyReader {
  return getReviewStorageAdapter();
}

function defaultOcrProvider(fileBodyReader?: ReviewFileBodyReader) {
  const config = getAnalysisProviderConfig();

  if (config.ocr.provider === "http") {
    return createHttpOcrProvider();
  }

  if (config.ocr.provider === "gemini") {
    return createGeminiOcrProvider(process.env, fileBodyReader);
  }

  return createDeterministicOcrProvider(fileBodyReader);
}

function agentTypeForIssue(issue: ReviewIssue): AgentType {
  const [sourceAgent] = issue.sourceAgents;

  if (
    sourceAgent === "english_translator_risk" ||
    sourceAgent === "japanese_translator_risk" ||
    sourceAgent === "chinese_translator_risk" ||
    sourceAgent === "korean_compliance_mapping"
  ) {
    return sourceAgent;
  }

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

function sourceFindingForIssue(
  issue: ReviewIssue,
  sourceAgentFindings: AgentFinding[] | undefined,
  reviewId: string
) {
  if (!sourceAgentFindings || sourceAgentFindings.length === 0) {
    return undefined;
  }

  return (
    sourceAgentFindings.find((finding) => issue.id === `issue-${reviewId}-${finding.id}`) ??
    sourceAgentFindings.find(
      (finding) =>
        issue.issueType === finding.issueType &&
        issue.targetText === finding.targetText &&
        issue.sourceAgents.includes(finding.agent)
    )
  );
}

function multilingualSnapshotsFromIssueContext(issue: ReviewIssue) {
  const multilingualContext = issue.multilingualContext;

  if (!multilingualContext) {
    return {};
  }

  return {
    localizedRiskFinding: {
      id: multilingualContext.segmentId,
      segmentId: multilingualContext.segmentId,
      language: multilingualContext.language,
      originalText: multilingualContext.originalText,
      literalTranslation: multilingualContext.literalTranslation,
      complianceMeaning: multilingualContext.complianceMeaning,
      riskCategory: multilingualContext.riskCategory,
      riskSignals: multilingualContext.riskSignals,
      riskLevelHint: issue.riskLevel,
      suggestedCopyOriginalLanguage: multilingualContext.suggestedCopyOriginalLanguage,
      suggestedCopyKoreanMeaning: multilingualContext.suggestedCopyKoreanMeaning,
      confidence: issue.confidence ?? 0.72
    },
    koreanComplianceMapping: {
      localizedFindingId: multilingualContext.segmentId,
      issueType: issue.issueType,
      koreanComplianceCategory: multilingualContext.koreanComplianceCategory,
      koreanComplianceReason: multilingualContext.koreanComplianceReason,
      evidenceQuery: multilingualContext.evidenceQuery,
      suggestedAction: issue.suggestedAction
    }
  };
}

function multilingualSnapshotsFromSourceFinding(finding: AgentFinding | undefined) {
  if (!finding?.localizedRiskFinding && !finding?.koreanComplianceMapping) {
    return {};
  }

  return {
    ...(finding.localizedRiskFinding ? { localizedRiskFinding: finding.localizedRiskFinding } : {}),
    ...(finding.koreanComplianceMapping
      ? { koreanComplianceMapping: finding.koreanComplianceMapping }
      : {})
  };
}

function issueToFinding(
  issue: ReviewIssue,
  sourceAgentFindings: AgentFinding[] | undefined,
  reviewId: string
): AgentFindingCandidate {
  const sourceFinding = sourceFindingForIssue(issue, sourceAgentFindings, reviewId);
  const sourceSnapshots = multilingualSnapshotsFromSourceFinding(sourceFinding);
  const multilingualSnapshots =
    Object.keys(sourceSnapshots).length > 0
      ? sourceSnapshots
      : multilingualSnapshotsFromIssueContext(issue);

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
    evidence: issue.evidence,
    ...multilingualSnapshots
  };
}

function combineAgentFindings(priorFindings: AgentFinding[], orchestratedFindings: AgentFinding[]) {
  const seenIds = new Set<string>();

  return [...priorFindings, ...orchestratedFindings].filter((finding) => {
    if (seenIds.has(finding.id)) {
      return false;
    }

    seenIds.add(finding.id);
    return true;
  });
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
      // OCR and knowledge/case RAG prefetch run in parallel: images spend 5–90s in Gemini OCR
      // while knowledge/case DB queries (~1–3s) complete before OCR finishes.
      const [extractedDocuments] = await Promise.all([
        ocrProvider.extract({ review, files: review.files }),
        ragRetriever.prefetch?.({ review, scope })
      ]);
      const analysisDocuments = documentsForAnalysis(extractedDocuments);
      // retrieve() uses the prefetched knowledge/case candidates and computes
      // product doc candidates from OCR results — no duplicate DB queries.
      const retrievedCandidates = await ragRetriever.retrieve({
        review,
        extractedDocuments: analysisDocuments,
        scope
      });
      const evidenceCandidates = (
        await reranker.rerank({
          query,
          candidates: retrievedCandidates
        })
      ).slice(0, config.rerank.topK);
      const multilingualSegments = segmentMultilingualDocuments(analysisDocuments);
      const multilingualResult =
        multilingualSegments.length > 0
          ? await runMultilingualRiskTeam({
              review,
              segments: multilingualSegments,
              evidenceCandidates,
              provider: modelProvider
            })
          : {
              localizedRiskFindings: [],
              koreanComplianceMappings: [],
              agentFindings: [],
              errors: []
            };
      const orchestratedFindings = await subAgentOrchestrator.run({
        review,
        extractedDocuments: analysisDocuments,
        evidenceCandidates,
        priorFindings: multilingualResult.agentFindings
      });
      const agentFindings = combineAgentFindings(
        multilingualResult.agentFindings,
        orchestratedFindings
      );
      const artifacts = {
        generatedAt: now().toISOString(),
        extractedDocuments: analysisDocuments,
        evidenceCandidates,
        ...(agentFindings.length > 0 ? { agentFindings } : {}),
        ...(multilingualSegments.length > 0 ? { multilingualSegments } : {}),
        ...(multilingualResult.localizedRiskFindings.length > 0
          ? { localizedRiskFindings: multilingualResult.localizedRiskFindings }
          : {}),
        ...(multilingualResult.koreanComplianceMappings.length > 0
          ? { koreanComplianceMappings: multilingualResult.koreanComplianceMappings }
          : {}),
        ...(multilingualResult.errors.length > 0
          ? { multilingualAgentErrors: multilingualResult.errors }
          : {})
      };
      const findings = buildAnalysisIssues(review, artifacts).map((issue) =>
        issueToFinding(issue, agentFindings, review.id)
      );

      return {
        ...artifacts,
        findings,
        ...(agentFindings.length > 0 ? { agentFindings } : {})
      };
    }
  };
}
