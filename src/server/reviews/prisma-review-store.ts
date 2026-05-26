import { randomUUID } from "node:crypto";
import { answerReviewQuestion } from "@/domain/chat";
import { getRequiredMaterialRows } from "@/domain/intake";
import { generateReviewReport } from "@/domain/reports";
import { classifyUploadFile } from "@/domain/upload-policy";
import type {
  ChatMessage,
  ChatSession,
  DraftVersion,
  Evidence,
  EvidenceChunk,
  KnowledgeDocument,
  PersistedReviewReport,
  ReviewCase,
  ReviewFile,
  ReviewIssue,
  ReviewSummary,
  RiskLevel
} from "@/domain/types";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/server/db/prisma";
import { buildAnalysisIssues, highestRiskLevelForIssues } from "@/server/analysis/issue-generation";
import type {
  AgentFindingCandidate,
  AnalysisArtifacts
} from "@/server/analysis/review-analysis-pipeline";
import { toReviewCase, toReviewSummary, type PrismaReviewCaseRow } from "./prisma-mappers";
import type {
  AnalysisJob,
  AuditEvent,
  AuditEventInput,
  CreateChatMessageInput,
  CreateDraftVersionInput,
  CreateKnowledgeDocumentChunkInput,
  CreateKnowledgeDocumentInput,
  CreateReviewReportInput,
  CreateReviewCaseFromUploadedFilesInput,
  CreateReviewCaseFromSamplePackageInput,
  CreateReviewCaseResult,
  FinalReviewStatus,
  ListAuditEventsOptions,
  ListIssuesOptions,
  ListReviewSummariesOptions,
  KnowledgeEvidenceSearchInput,
  ReviewStore,
  ReviewSummaryPage,
  ReviewStoreScope,
  SaveIssueDecisionInput
} from "./review-store";

const reviewInclude = {
  files: true,
  issues: {
    orderBy: { id: "asc" },
    include: {
      evidence: { orderBy: { id: "asc" } }
    }
  }
} as const;

const uploadAnalysisNotice = "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다.";

function plannedDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function confidenceFor(fileType: ReviewFile["fileType"]): number {
  if (fileType === "misc") {
    return 0.62;
  }

  if (fileType === "package_archive") {
    return 0.66;
  }

  if (fileType === "promotional_creative" || fileType === "rate_table") {
    return 0.78;
  }

  return 0.74;
}

function missingMaterialKeys(review: Pick<ReviewCase, "productType" | "files">): string[] {
  return getRequiredMaterialRows(review)
    .filter((row) => row.status === "missing")
    .map((row) => (row.fileType === "checklist" ? "internal_checklist" : row.fileType));
}

function defaultExpectedDraft(productType: ReviewCase["productType"]): string {
  return `${productType} 상품 실제 업로드 자료는 접수되었습니다. 현재 Demo MVP에서는 OCR/RAG 분석 전이므로 파일 분류와 누락 자료 확인 결과를 기준으로 추가 확인이 필요합니다.`;
}

function reviewRow(row: unknown): PrismaReviewCaseRow {
  return row as PrismaReviewCaseRow;
}

function toAnalysisJob(row: {
  id: string;
  reviewCaseId: string;
  status: AnalysisJob["status"];
  progress: number;
  currentStep: string;
  startedByUserId: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  artifacts: Prisma.JsonValue | null;
}): AnalysisJob {
  return {
    id: row.id,
    reviewCaseId: row.reviewCaseId,
    status: row.status,
    progress: row.progress,
    currentStep: row.currentStep,
    startedByUserId: row.startedByUserId ?? undefined,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    errorMessage: row.errorMessage ?? undefined,
    artifacts: (row.artifacts as AnalysisArtifacts | null) ?? undefined
  };
}

function toAuditEvent(row: {
  id: string;
  tenantId: string;
  userId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  beforeValue: Prisma.JsonValue | null;
  afterValue: Prisma.JsonValue | null;
  ipAddress: string | null;
  createdAt: Date;
}): AuditEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId ?? "",
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId ?? undefined,
    beforeValue: (row.beforeValue as Record<string, unknown> | null) ?? undefined,
    afterValue: (row.afterValue as Record<string, unknown> | null) ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    createdAt: row.createdAt.toISOString()
  };
}

function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toKnowledgeDocument(row: {
  id: string;
  tenantId: string;
  affiliateId: string | null;
  documentType: KnowledgeDocument["documentType"];
  productType: KnowledgeDocument["productType"] | null;
  title: string;
  version: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  approvalStatus: KnowledgeDocument["approvalStatus"];
  storageKey: string;
  createdById: string;
  approvedById: string | null;
  createdAt: Date;
  approvedAt: Date | null;
}): KnowledgeDocument {
  return {
    id: row.id,
    tenantId: row.tenantId,
    affiliateId: row.affiliateId ?? undefined,
    documentType: row.documentType,
    productType: row.productType ?? undefined,
    title: row.title,
    version: row.version,
    effectiveFrom: dateOnlyString(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? dateOnlyString(row.effectiveTo) : undefined,
    approvalStatus: row.approvalStatus,
    storageKey: row.storageKey,
    createdBy: row.createdById,
    approvedBy: row.approvedById ?? undefined,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString()
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toEvidenceChunk(row: {
  id: string;
  tenantId: string;
  knowledgeDocumentId: string | null;
  reviewFileId: string | null;
  chunkText: string;
  chunkSummary: string | null;
  embeddingModel: string;
  embeddingId: string;
  page: number | null;
  section: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}): EvidenceChunk {
  return {
    id: row.id,
    tenantId: row.tenantId,
    knowledgeDocumentId: row.knowledgeDocumentId ?? undefined,
    reviewFileId: row.reviewFileId ?? undefined,
    chunkText: row.chunkText,
    chunkSummary: row.chunkSummary ?? undefined,
    embeddingModel: row.embeddingModel,
    embeddingId: row.embeddingId,
    page: row.page ?? undefined,
    section: row.section ?? undefined,
    metadata: jsonObject(row.metadata),
    createdAt: row.createdAt.toISOString()
  };
}

function toChatSession(row: {
  id: string;
  reviewCaseId: string;
  issueId: string | null;
  userId: string;
  mode: ChatSession["mode"];
  createdAt: Date;
}): ChatSession {
  return {
    id: row.id,
    reviewCaseId: row.reviewCaseId,
    issueId: row.issueId ?? undefined,
    userId: row.userId,
    mode: row.mode,
    createdAt: row.createdAt.toISOString()
  };
}

function toChatMessage(row: {
  id: string;
  chatSessionId: string;
  role: ChatMessage["role"];
  content: string;
  evidenceIds: Prisma.JsonValue;
  markedForDraft: boolean;
  createdAt: Date;
}): ChatMessage {
  return {
    id: row.id,
    chatSessionId: row.chatSessionId,
    role: row.role,
    content: row.content,
    evidenceIds: jsonStringArray(row.evidenceIds),
    markedForDraft: row.markedForDraft,
    createdAt: row.createdAt.toISOString()
  };
}

function toDraftVersion(row: {
  id: string;
  reviewCaseId: string;
  version: number;
  draft: string;
  source: DraftVersion["source"];
  sourceMessageIds: Prisma.JsonValue;
  evidenceIds: Prisma.JsonValue;
  createdById: string;
  createdAt: Date;
}): DraftVersion {
  return {
    id: row.id,
    reviewCaseId: row.reviewCaseId,
    version: row.version,
    draft: row.draft,
    source: row.source,
    sourceMessageIds: jsonStringArray(row.sourceMessageIds),
    evidenceIds: jsonStringArray(row.evidenceIds),
    createdBy: row.createdById,
    createdAt: row.createdAt.toISOString()
  };
}

function toReviewReport(row: {
  id: string;
  reviewCaseId: string;
  reportType: PersistedReviewReport["reportType"];
  contentMarkdown: string;
  evidenceIds: Prisma.JsonValue;
  version: number;
  storageKey: string | null;
  createdById: string;
  createdAt: Date;
}): PersistedReviewReport {
  return {
    id: row.id,
    reviewCaseId: row.reviewCaseId,
    reportType: row.reportType,
    contentMarkdown: row.contentMarkdown,
    evidenceIds: jsonStringArray(row.evidenceIds),
    version: row.version,
    storageKey: row.storageKey ?? undefined,
    createdBy: row.createdById,
    createdAt: row.createdAt.toISOString()
  };
}

function summaryPage(
  items: ReviewSummary[],
  page: number,
  pageSize: number,
  total: number
): ReviewSummaryPage {
  return {
    items,
    reviewCases: items,
    page,
    pageSize,
    total
  };
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function retryUniqueConstraint<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isUniqueConstraintError(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw lastError;
}

class AnalysisJobTransitionConflictError extends Error {}

function chunkIdForReviewDocument(reviewCaseId: string, fileId: string): string {
  return `chunk-${reviewCaseId}-${fileId}`;
}

function chunkIdForKnowledgeDocument(documentId: string): string {
  return `chunk-${documentId}-001`;
}

function lexicalKnowledgeScore(query: string, text: string): number {
  const terms = query
    .split(/[\s.,:;!?()[\]{}"'`~|\\/]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  if (terms.length === 0) {
    return 0.72;
  }

  const target = text.toLowerCase();
  const matches = terms.filter((term) => target.includes(term.toLowerCase())).length;

  return Math.max(0.55, Math.min(0.99, 0.55 + matches / terms.length / 2));
}

function documentSourceType(
  documentType: KnowledgeDocument["documentType"]
): Evidence["sourceType"] {
  return documentType === "law" ? "law" : "internal_policy";
}

function vectorLiteral(vector: number[] | undefined): string | undefined {
  if (!vector || vector.length === 0 || !vector.every((value) => Number.isFinite(value))) {
    return undefined;
  }

  return `[${vector.join(",")}]`;
}

function embeddingVectorFromMetadata(metadata: Record<string, unknown>): number[] | undefined {
  const vector = metadata.embeddingVector;

  return Array.isArray(vector) && vector.every((value) => typeof value === "number")
    ? vector
    : undefined;
}

const riskPriority: Record<RiskLevel, number> = {
  info: 0,
  caution: 1,
  high: 2,
  reject_recommended: 3
};

function highestRiskLevelFrom(riskLevels: RiskLevel[], fallback: RiskLevel): RiskLevel {
  return riskLevels.reduce(
    (highest, riskLevel) => (riskPriority[riskLevel] > riskPriority[highest] ? riskLevel : highest),
    fallback
  );
}

function agentTypeFromSourceAgents(sourceAgents: string[]): AgentFindingCandidate["agentType"] {
  const [sourceAgent] = sourceAgents;

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

function findingFromIssue(issue: ReviewIssue): AgentFindingCandidate {
  return {
    agentType: agentTypeFromSourceAgents(issue.sourceAgents),
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

function findingsFromArtifacts(
  review: ReviewCase,
  artifacts: AnalysisArtifacts
): AgentFindingCandidate[] {
  return artifacts.findings && artifacts.findings.length > 0
    ? artifacts.findings
    : buildAnalysisIssues(review, artifacts).map(findingFromIssue);
}

type AllowedEvidenceChunk = {
  id: string;
  knowledgeDocumentId: string | null;
  documentVersion?: string | null;
  documentEffectiveFrom?: Date | null;
};

type VectorKnowledgeEvidenceRow = {
  chunkId: string;
  documentId: string;
  documentType: KnowledgeDocument["documentType"];
  title: string;
  version: string;
  effectiveFrom: Date | string;
  chunkSummary: string | null;
  chunkText: string;
  page: number | null;
  section: string | null;
  relevanceScore: number | string;
};

function dateOnlyFromRaw(value: Date | string): string {
  return value instanceof Date ? dateOnlyString(value) : value.slice(0, 10);
}

function vectorRowToEvidence(row: VectorKnowledgeEvidenceRow): Evidence {
  return {
    id: `knowledge-evidence-${row.chunkId}`,
    sourceType: documentSourceType(row.documentType),
    documentId: row.documentId,
    chunkId: row.chunkId,
    version: row.version,
    effectiveFrom: dateOnlyFromRaw(row.effectiveFrom),
    title: row.title,
    page: row.page ?? undefined,
    section: row.section ?? undefined,
    quoteSummary: row.chunkSummary ?? row.chunkText,
    relevanceScore: Number(row.relevanceScore)
  };
}

function evidenceCreateInput(
  reviewCaseId: string,
  issueId: string,
  finding: AgentFindingCandidate,
  allowedChunks: Map<string, AllowedEvidenceChunk>
) {
  return finding.evidence.map((evidence, index) => {
    const chunkId = (() => {
      const sourceFileChunkId = evidence.sourceFileId
        ? chunkIdForReviewDocument(reviewCaseId, evidence.sourceFileId)
        : undefined;

      if (sourceFileChunkId && allowedChunks.has(sourceFileChunkId)) {
        return sourceFileChunkId;
      }

      return evidence.chunkId && allowedChunks.has(evidence.chunkId) ? evidence.chunkId : undefined;
    })();
    const allowedChunk = chunkId ? allowedChunks.get(chunkId) : undefined;
    const hasAllowedKnowledgeDocument =
      allowedChunk?.knowledgeDocumentId &&
      (!evidence.documentId || allowedChunk.knowledgeDocumentId === evidence.documentId);
    const documentId = hasAllowedKnowledgeDocument ? allowedChunk.knowledgeDocumentId : undefined;

    return {
      id: `evidence-${issueId}-${String(index + 1).padStart(3, "0")}`,
      sourceType: evidence.sourceType,
      documentId,
      chunkId,
      version: hasAllowedKnowledgeDocument ? allowedChunk.documentVersion : undefined,
      effectiveFrom: hasAllowedKnowledgeDocument ? allowedChunk.documentEffectiveFrom : undefined,
      title: evidence.title,
      page: evidence.page,
      section: evidence.section,
      quoteSummary: evidence.quoteSummary,
      relevanceScore: evidence.relevanceScore
    };
  });
}

function issueCreateData(reviewCaseId: string, issue: ReviewIssue) {
  return {
    id: issue.id,
    reviewCaseId,
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    reviewerRiskLevel: issue.reviewerRiskLevel,
    title: issue.title,
    targetText: issue.targetText,
    targetBbox: issue.targetBbox as Prisma.InputJsonValue,
    targetFileId: issue.targetFileId,
    targetPage: issue.targetPage,
    confidence: issue.confidence,
    agentFindingId: issue.agentFindingId,
    sourceAgents: issue.sourceAgents as Prisma.InputJsonValue,
    suggestedAction: issue.suggestedAction,
    finalAction: issue.finalAction,
    reviewerComment: issue.reviewerComment,
    status: issue.status,
    description: issue.description,
    suggestedCopy: issue.suggestedCopy,
    evidence: {
      create: issue.evidence.map((evidence) => ({
        id: evidence.id,
        sourceType: evidence.sourceType,
        documentId: evidence.documentId,
        chunkId: evidence.chunkId,
        version: evidence.version,
        effectiveFrom: evidence.effectiveFrom ? plannedDate(evidence.effectiveFrom) : undefined,
        title: evidence.title,
        page: evidence.page,
        section: evidence.section,
        quoteSummary: evidence.quoteSummary,
        relevanceScore: evidence.relevanceScore
      }))
    }
  };
}

export function createPrismaReviewStore(): ReviewStore {
  const prisma = getPrismaClient();

  async function getReviewCase(scope: ReviewStoreScope, id: string) {
    const row = await prisma.reviewCase.findFirst({
      where: { id, tenantId: scope.tenantId },
      include: reviewInclude
    });

    return row ? toReviewCase(reviewRow(row)) : undefined;
  }

  return {
    async listReviewSummaries(scope, options: ListReviewSummariesOptions = {}) {
      const page = Math.max(1, options.page ?? 1);
      const pageSize = Math.max(1, options.pageSize ?? 50);
      const where: Prisma.ReviewCaseWhereInput = {
        tenantId: scope.tenantId,
        status: options.status,
        productType: options.productType,
        affiliateId: options.affiliateId,
        highestRiskLevel: options.riskLevel
      };
      const [rows, total] = await prisma.$transaction([
        prisma.reviewCase.findMany({
          where,
          include: reviewInclude,
          orderBy: { updatedAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize
        }),
        prisma.reviewCase.count({ where })
      ]);

      return summaryPage(
        rows.map((row) => toReviewSummary(reviewRow(row))),
        page,
        pageSize,
        total
      );
    },

    async listCaseLibrary(scope, options: ListReviewSummariesOptions = {}) {
      const page = Math.max(1, options.page ?? 1);
      const pageSize = Math.max(1, options.pageSize ?? 50);
      const finalStatuses = ["approved", "change_requested", "rejected", "on_hold"] as const;

      if (
        options.status &&
        !finalStatuses.includes(options.status as (typeof finalStatuses)[number])
      ) {
        return summaryPage([], page, pageSize, 0);
      }

      const where: Prisma.ReviewCaseWhereInput = {
        tenantId: scope.tenantId,
        status: options.status ?? { in: [...finalStatuses] },
        productType: options.productType,
        affiliateId: options.affiliateId,
        highestRiskLevel: options.riskLevel
      };

      const [rows, total] = await prisma.$transaction([
        prisma.reviewCase.findMany({
          where,
          include: reviewInclude,
          orderBy: { updatedAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize
        }),
        prisma.reviewCase.count({ where })
      ]);

      return summaryPage(
        rows.map((row) => toReviewSummary(reviewRow(row))),
        page,
        pageSize,
        total
      );
    },

    async isReviewCaseIdAvailable(_scope, id) {
      const existing = await prisma.reviewCase.count({ where: { id } });

      return existing === 0;
    },

    async createKnowledgeDocument(scope, input: CreateKnowledgeDocumentInput) {
      const affiliate = input.affiliateId
        ? await prisma.affiliate.findFirst({
            where: { id: input.affiliateId, tenantId: scope.tenantId },
            select: { id: true }
          })
        : undefined;
      const document = await prisma.knowledgeDocument.create({
        data: {
          id: input.id ?? `knowledge-${randomUUID()}`,
          tenantId: scope.tenantId,
          affiliateId: affiliate?.id,
          documentType: input.documentType,
          productType: input.productType,
          title: input.title,
          version: input.version,
          effectiveFrom: plannedDate(input.effectiveFrom),
          approvalStatus: "draft",
          storageKey: input.storageKey,
          createdById: scope.actorUserId
        }
      });

      return toKnowledgeDocument(document);
    },

    async listKnowledgeDocuments(scope) {
      const documents = await prisma.knowledgeDocument.findMany({
        where: { tenantId: scope.tenantId },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }]
      });

      return documents.map(toKnowledgeDocument);
    },

    async approveKnowledgeDocument(scope, documentId) {
      return prisma.$transaction(async (tx) => {
        const approvedAt = new Date();
        const updated = await tx.knowledgeDocument.updateMany({
          where: { id: documentId, tenantId: scope.tenantId },
          data: {
            approvalStatus: "approved",
            approvedById: scope.actorUserId,
            approvedAt
          }
        });

        if (updated.count !== 1) {
          return undefined;
        }

        const document = await tx.knowledgeDocument.findUniqueOrThrow({
          where: { id: documentId }
        });

        const existingChunkCount = await tx.evidenceChunk.count({
          where: { tenantId: document.tenantId, knowledgeDocumentId: document.id }
        });

        if (existingChunkCount === 0) {
          await tx.evidenceChunk.create({
            data: {
              id: chunkIdForKnowledgeDocument(document.id),
              tenantId: document.tenantId,
              knowledgeDocumentId: document.id,
              chunkText: `${document.title} ${document.version}`,
              chunkSummary: document.title,
              embeddingModel: "text-embedding-3-small",
              embeddingId: `embedding-${document.id}-001`,
              metadata: { source: "knowledge_document" }
            }
          });
        }

        return toKnowledgeDocument(document);
      });
    },

    async replaceKnowledgeDocumentChunks(
      scope,
      documentId,
      chunks: CreateKnowledgeDocumentChunkInput[]
    ) {
      const document = await prisma.knowledgeDocument.findFirst({
        where: { id: documentId, tenantId: scope.tenantId },
        select: { id: true }
      });

      if (!document) {
        return undefined;
      }

      return prisma.$transaction(async (tx) => {
        await tx.evidenceChunk.deleteMany({
          where: { tenantId: scope.tenantId, knowledgeDocumentId: documentId }
        });

        if (chunks.length > 0) {
          await tx.evidenceChunk.createMany({
            data: chunks.map((chunk) => ({
              id: chunk.id,
              tenantId: scope.tenantId,
              knowledgeDocumentId: documentId,
              chunkText: chunk.chunkText,
              chunkSummary: chunk.chunkSummary,
              embeddingModel: chunk.embeddingModel,
              embeddingId: chunk.embeddingId,
              page: chunk.page,
              section: chunk.section,
              metadata: chunk.metadata as Prisma.InputJsonValue
            }))
          });
        }

        for (const chunk of chunks) {
          const literal = vectorLiteral(embeddingVectorFromMetadata(chunk.metadata));

          if (literal) {
            await tx.$executeRawUnsafe(
              'UPDATE "evidence_chunks" SET "embedding_vector" = $1::vector WHERE "id" = $2 AND "tenant_id" = $3',
              literal,
              chunk.id,
              scope.tenantId
            );
          }
        }

        const rows = await tx.evidenceChunk.findMany({
          where: { tenantId: scope.tenantId, knowledgeDocumentId: documentId },
          orderBy: { id: "asc" }
        });

        return rows.map(toEvidenceChunk);
      });
    },

    async searchKnowledgeEvidence(scope, input: KnowledgeEvidenceSearchInput) {
      const topK = input.topK ?? 4;
      const minScore = input.minScore ?? 0.72;
      const queryVector = vectorLiteral(input.queryEmbedding);

      if (queryVector) {
        const params: Array<string | number> = [scope.tenantId, queryVector];
        const whereParts = [
          'ec."tenant_id" = $1',
          'kd."tenant_id" = $1',
          "kd.\"approval_status\" = 'approved'",
          'ec."embedding_vector" IS NOT NULL'
        ];

        if (input.productType) {
          params.push(input.productType);
          whereParts.push(
            `(kd."product_type" = $${params.length}::"ProductType" OR kd."product_type" IS NULL)`
          );
        }

        if (input.affiliateId) {
          params.push(input.affiliateId);
          whereParts.push(`(kd."affiliate_id" = $${params.length} OR kd."affiliate_id" IS NULL)`);
        }

        params.push(Math.max(topK * 4, topK));

        try {
          const rows = await prisma.$queryRawUnsafe<VectorKnowledgeEvidenceRow[]>(
            `
              SELECT
                ec."id" AS "chunkId",
                kd."id" AS "documentId",
                kd."document_type" AS "documentType",
                kd."title" AS "title",
                kd."version" AS "version",
                kd."effective_from" AS "effectiveFrom",
                ec."chunk_summary" AS "chunkSummary",
                ec."chunk_text" AS "chunkText",
                ec."page" AS "page",
                ec."section" AS "section",
                GREATEST(0, 1 - (ec."embedding_vector" <=> $2::vector)) AS "relevanceScore"
              FROM "evidence_chunks" ec
              INNER JOIN "knowledge_documents" kd ON kd."id" = ec."knowledge_document_id"
              WHERE ${whereParts.join(" AND ")}
              ORDER BY ec."embedding_vector" <=> $2::vector
              LIMIT $${params.length}
            `,
            ...params
          );
          const evidence = rows
            .map(vectorRowToEvidence)
            .filter((item) => item.relevanceScore >= minScore)
            .slice(0, topK);

          if (evidence.length > 0) {
            return evidence;
          }
        } catch {
          // Fall back to lexical retrieval when pgvector is not available in a local database.
        }
      }

      const documentFilters: Prisma.KnowledgeDocumentWhereInput[] = [
        {
          tenantId: scope.tenantId,
          approvalStatus: "approved"
        }
      ];

      if (input.productType) {
        documentFilters.push({
          OR: [{ productType: input.productType }, { productType: null }]
        });
      }

      if (input.affiliateId) {
        documentFilters.push({
          OR: [{ affiliateId: input.affiliateId }, { affiliateId: null }]
        });
      }

      const rows = await prisma.evidenceChunk.findMany({
        where: {
          tenantId: scope.tenantId,
          knowledgeDocument: {
            is: { AND: documentFilters }
          }
        },
        include: {
          knowledgeDocument: true
        },
        orderBy: { id: "asc" },
        take: Math.max(topK * 4, topK)
      });

      return rows
        .flatMap((chunk) => {
          const document = chunk.knowledgeDocument;

          if (!document) {
            return [];
          }

          const score = lexicalKnowledgeScore(input.query, chunk.chunkText);

          if (score < minScore) {
            return [];
          }

          return [
            {
              id: `knowledge-evidence-${chunk.id}`,
              sourceType: documentSourceType(document.documentType),
              documentId: document.id,
              chunkId: chunk.id,
              version: document.version,
              effectiveFrom: dateOnlyString(document.effectiveFrom),
              title: document.title,
              page: chunk.page ?? undefined,
              section: chunk.section ?? undefined,
              quoteSummary: chunk.chunkSummary ?? chunk.chunkText,
              relevanceScore: score
            }
          ];
        })
        .sort((left, right) => right.relevanceScore - left.relevanceScore)
        .slice(0, topK);
    },

    async createChatSession(scope, input) {
      const review = await prisma.reviewCase.findFirst({
        where: { id: input.reviewCaseId, tenantId: scope.tenantId },
        select: { id: true }
      });

      if (!review) {
        return undefined;
      }

      if (input.issueId) {
        const issue = await prisma.reviewIssue.findFirst({
          where: {
            id: input.issueId,
            reviewCaseId: input.reviewCaseId,
            reviewCase: { tenantId: scope.tenantId }
          },
          select: { id: true }
        });

        if (!issue) {
          return undefined;
        }
      }

      const session = await prisma.chatSession.create({
        data: {
          id: `chat-session-${randomUUID()}`,
          reviewCaseId: input.reviewCaseId,
          issueId: input.issueId,
          userId: scope.actorUserId,
          mode: input.mode
        }
      });

      return toChatSession(session);
    },

    async createChatMessage(scope, input: CreateChatMessageInput) {
      const session = await prisma.chatSession.findFirst({
        where: {
          id: input.sessionId,
          reviewCase: { tenantId: scope.tenantId }
        },
        select: {
          id: true,
          reviewCaseId: true,
          issueId: true
        }
      });

      if (!session) {
        return undefined;
      }

      const review = await getReviewCase(scope, session.reviewCaseId);

      if (!review) {
        return undefined;
      }

      const issue = session.issueId
        ? review.issues.find((candidate) => candidate.id === session.issueId)
        : undefined;
      const response =
        issue !== undefined
          ? answerReviewQuestion({ review, issue, question: input.content })
          : {
              content:
                "추가 확인 필요: 특정 이슈와 연결되지 않은 질의는 현재 승인된 근거만으로 단정할 수 없습니다.",
              evidence: [] as ReviewCase["issues"][number]["evidence"]
            };
      const now = new Date();
      const [userMessage, assistantMessage] = await prisma.$transaction([
        prisma.chatMessage.create({
          data: {
            id: `chat-message-${randomUUID()}`,
            chatSessionId: session.id,
            role: "user",
            content: input.content,
            evidenceIds: [],
            markedForDraft: false,
            createdAt: now
          }
        }),
        prisma.chatMessage.create({
          data: {
            id: `chat-message-${randomUUID()}`,
            chatSessionId: session.id,
            role: "assistant",
            content: response.content,
            evidenceIds: response.evidence.map((evidence) => evidence.id),
            markedForDraft: false,
            createdAt: now
          }
        })
      ]);

      return {
        userMessage: toChatMessage(userMessage),
        assistantMessage: toChatMessage(assistantMessage)
      };
    },

    async markChatMessageForDraft(scope, messageId, markedForDraft) {
      const updated = await prisma.chatMessage.updateMany({
        where: {
          id: messageId,
          chatSession: { reviewCase: { tenantId: scope.tenantId } }
        },
        data: { markedForDraft }
      });

      if (updated.count !== 1) {
        return undefined;
      }

      const message = await prisma.chatMessage.findFirst({
        where: {
          id: messageId,
          chatSession: { reviewCase: { tenantId: scope.tenantId } }
        }
      });

      return message ? toChatMessage(message) : undefined;
    },

    async createDraftVersion(scope, reviewCaseId, input: CreateDraftVersionInput) {
      return prisma.$transaction(async (tx) => {
        const reviewRowValue = await tx.reviewCase.findFirst({
          where: { id: reviewCaseId, tenantId: scope.tenantId },
          include: reviewInclude
        });

        if (!reviewRowValue) {
          return undefined;
        }

        const review = toReviewCase(reviewRow(reviewRowValue));
        const markedMessages = await tx.chatMessage.findMany({
          where: {
            role: "assistant",
            markedForDraft: true,
            chatSession: {
              reviewCaseId,
              reviewCase: { tenantId: scope.tenantId }
            }
          },
          orderBy: { createdAt: "asc" }
        });
        const validSourceMessages =
          input.sourceMessageIds !== undefined
            ? await tx.chatMessage.findMany({
                where: {
                  id: { in: input.sourceMessageIds },
                  role: "assistant",
                  chatSession: {
                    reviewCaseId,
                    reviewCase: { tenantId: scope.tenantId }
                  }
                },
                select: { id: true }
              })
            : [];
        const validSourceMessageIds = new Set(validSourceMessages.map((message) => message.id));
        const sourceMessageIds =
          input.sourceMessageIds !== undefined
            ? input.sourceMessageIds.filter((id) => validSourceMessageIds.has(id))
            : markedMessages.map((message) => message.id);
        const validRequestedEvidence =
          input.evidenceIds !== undefined
            ? await tx.evidence.findMany({
                where: {
                  id: { in: input.evidenceIds },
                  issue: {
                    reviewCaseId,
                    reviewCase: { tenantId: scope.tenantId }
                  }
                },
                select: { id: true }
              })
            : [];
        const validRequestedEvidenceIdSet = new Set(
          validRequestedEvidence.map((evidence) => evidence.id)
        );
        const validRequestedEvidenceIds =
          input.evidenceIds !== undefined
            ? input.evidenceIds.filter((id) => validRequestedEvidenceIdSet.has(id))
            : [];
        const evidenceIds = unique([
          ...validRequestedEvidenceIds,
          ...markedMessages.flatMap((message) => jsonStringArray(message.evidenceIds))
        ]);
        const draft = input.draft?.trim()
          ? input.draft
          : markedMessages.length > 0
            ? `${review.expectedDraft}\n\n채팅 반영: ${markedMessages
                .map((message) => message.content)
                .join("\n")}`
            : review.expectedDraft;
        const updatedReview = await tx.reviewCase.update({
          where: { id: reviewCaseId },
          data: {
            currentDraft: draft,
            currentDraftVersion: { increment: 1 }
          },
          select: { currentDraftVersion: true }
        });
        const nextVersion = updatedReview.currentDraftVersion;
        const draftVersion = await tx.draftVersion.create({
          data: {
            id: `draft-${reviewCaseId}-v${nextVersion}`,
            reviewCaseId,
            version: nextVersion,
            draft,
            source: input.source,
            sourceMessageIds: sourceMessageIds as Prisma.InputJsonValue,
            evidenceIds: evidenceIds as Prisma.InputJsonValue,
            createdById: scope.actorUserId
          }
        });

        return toDraftVersion(draftVersion);
      });
    },

    async createReviewReport(scope, reviewCaseId, input: CreateReviewReportInput) {
      return retryUniqueConstraint(() =>
        prisma.$transaction(async (tx) => {
          const reviewRowValue = await tx.reviewCase.findFirst({
            where: { id: reviewCaseId, tenantId: scope.tenantId },
            include: reviewInclude
          });

          if (!reviewRowValue) {
            return undefined;
          }

          const review = toReviewCase(reviewRow(reviewRowValue));
          const versionAggregate = await tx.reviewReport.aggregate({
            where: { reviewCaseId },
            _max: { version: true }
          });
          const nextVersion = (versionAggregate._max.version ?? 0) + 1;
          const generated = generateReviewReport({
            review,
            reportType: input.reportType,
            tone: input.tone,
            includeChatContext: input.includeChatContext,
            issueIds: input.issueIds,
            draft: input.draft
          });
          const report = await tx.reviewReport.create({
            data: {
              id: `report-${reviewCaseId}-v${nextVersion}`,
              reviewCaseId,
              reportType: input.reportType,
              contentMarkdown: generated.contentMarkdown,
              evidenceIds: generated.evidenceIds as Prisma.InputJsonValue,
              version: nextVersion,
              storageKey: `reports/${reviewCaseId}/v${nextVersion}.md`,
              createdById: scope.actorUserId
            }
          });

          return toReviewReport(report);
        })
      );
    },

    getReviewCase,

    async createReviewCaseFromSamplePackage(
      scope,
      input: CreateReviewCaseFromSamplePackageInput
    ): Promise<CreateReviewCaseResult | undefined> {
      const sample = await prisma.reviewCase.findFirst({
        where: { id: input.samplePackageId, tenantId: scope.tenantId },
        include: reviewInclude
      });

      if (!sample) {
        return undefined;
      }

      const [, updated] = await prisma.$transaction([
        prisma.analysisJob.deleteMany({
          where: { tenantId: scope.tenantId, reviewCaseId: sample.id }
        }),
        prisma.reviewCase.update({
          where: { id: sample.id },
          data: {
            status: "analysis_waiting",
            analysisStartedAt: null,
            analysisCompletedAt: null,
            finalDecisionAt: null
          },
          include: reviewInclude
        })
      ]);
      const reviewCase = toReviewCase(reviewRow(updated));

      return {
        reviewCase,
        files: reviewCase.files,
        missingMaterials: reviewCase.missingMaterials,
        analysisStartHref: `/api/v1/review-cases/${reviewCase.id}/analysis/start`
      };
    },

    async createReviewCaseFromUploadedFiles(scope, input: CreateReviewCaseFromUploadedFilesInput) {
      const id = input.reviewCaseId ?? `rc-${randomUUID()}`;
      const affiliate = await prisma.affiliate.findFirst({
        where: { tenantId: scope.tenantId, name: input.affiliate },
        select: { id: true }
      });
      const files = input.files.map((file) => {
        const contentType = file.type || "application/octet-stream";
        const fileType = classifyUploadFile({ ...file, type: contentType });

        return {
          id: file.id ?? `file-${randomUUID()}`,
          originalFilename: file.name,
          fileType,
          classificationConfidence: confidenceFor(fileType),
          parseStatus: "pending" as const,
          storageProvider: file.storageProvider ?? "local",
          storageKey: file.storageKey ?? `local/${id}/${file.name}`,
          contentType,
          sizeBytes: BigInt(file.size)
        };
      });
      const missingMaterials = missingMaterialKeys({
        productType: input.productType,
        files: files.map((file) => ({
          id: file.id,
          name: file.originalFilename,
          fileType: file.fileType,
          classificationConfidence: file.classificationConfidence,
          parseStatus: file.parseStatus,
          storageProvider: file.storageProvider as ReviewFile["storageProvider"],
          storageKey: file.storageKey,
          contentType: file.contentType,
          sizeBytes: Number(file.sizeBytes)
        }))
      });

      const created = await prisma.reviewCase.create({
        data: {
          id,
          tenantId: scope.tenantId,
          affiliateId: affiliate?.id,
          affiliateName: input.affiliate,
          title: input.title,
          productType: input.productType,
          channelType: input.channelType,
          plannedPublishDate: plannedDate(input.plannedPublishDate),
          status: "analysis_waiting",
          highestRiskLevel: "info",
          requesterId: scope.actorUserId,
          reviewerId: process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo",
          requesterName: "업로드 요청자",
          reviewerName: "준법심의자 박민준",
          promotionalCopy: "실제 업로드 자료 분석 대기",
          disclosure: uploadAnalysisNotice,
          productDescription: "실제 업로드 파일의 본문 추출은 아직 적용되지 않았습니다.",
          missingMaterials,
          expectedDraft: defaultExpectedDraft(input.productType),
          analysisNotice: uploadAnalysisNotice,
          files: { create: files }
        },
        include: reviewInclude
      });
      const reviewCase = toReviewCase(reviewRow(created));

      return {
        reviewCase,
        files: reviewCase.files,
        missingMaterials: reviewCase.missingMaterials,
        analysisStartHref: `/api/v1/review-cases/${reviewCase.id}/analysis/start`
      };
    },

    async startAnalysis(scope, reviewCaseId, options = {}) {
      const review = await prisma.reviewCase.findFirst({
        where: { id: reviewCaseId, tenantId: scope.tenantId },
        include: reviewInclude
      });

      if (!review) {
        return undefined;
      }

      const now = new Date();
      const reviewCase = toReviewCase(reviewRow(review));
      const generatedIssues =
        options.artifacts && reviewCase.issues.length === 0
          ? buildAnalysisIssues(reviewCase, options.artifacts)
          : [];
      const issuesForRisk = generatedIssues.length > 0 ? generatedIssues : reviewCase.issues;

      const result = await prisma.$transaction(async (tx) => {
        const job = await tx.analysisJob.create({
          data: {
            id: `job-${randomUUID()}`,
            tenantId: scope.tenantId,
            reviewCaseId,
            status: "completed",
            progress: 100,
            currentStep: "deterministic_mock_analysis",
            startedByUserId: scope.actorUserId,
            artifacts: options.artifacts as Prisma.InputJsonValue | undefined,
            startedAt: now,
            completedAt: now
          }
        });

        for (const issue of generatedIssues) {
          await tx.reviewIssue.create({
            data: issueCreateData(reviewCaseId, issue)
          });
        }

        const updated = await tx.reviewCase.update({
          where: { id: reviewCaseId },
          data: {
            status: "analysis_complete",
            highestRiskLevel: highestRiskLevelForIssues(reviewCase.highestRiskLevel, issuesForRisk),
            analysisStartedAt: now,
            analysisCompletedAt: now
          },
          include: reviewInclude
        });

        return { job, updated };
      });

      return {
        reviewCaseId,
        status: "analysis_complete",
        issueCount: result.updated.issues.length,
        analysisHref: `/reviews/${reviewCaseId}`,
        analysisNotice: result.updated.analysisNotice ?? undefined,
        jobId: result.job.id,
        extractedDocumentCount: options.artifacts?.extractedDocuments.length,
        evidenceCandidateCount: options.artifacts?.evidenceCandidates.length
      };
    },

    async enqueueAnalysis(scope, reviewCaseId) {
      try {
        return await prisma.$transaction(async (tx) => {
          const review = await tx.reviewCase.findFirst({
            where: { id: reviewCaseId, tenantId: scope.tenantId },
            include: reviewInclude
          });

          if (!review) {
            return undefined;
          }

          const activeJob = await tx.analysisJob.findFirst({
            where: {
              tenantId: scope.tenantId,
              reviewCaseId,
              status: { in: ["queued", "running"] }
            },
            select: { id: true }
          });

          if (activeJob) {
            return undefined;
          }

          const job = await tx.analysisJob.create({
            data: {
              id: `job-${randomUUID()}`,
              tenantId: scope.tenantId,
              reviewCaseId,
              status: "queued",
              progress: 0,
              currentStep: "queued",
              startedByUserId: scope.actorUserId
            }
          });
          const updated = await tx.reviewCase.update({
            where: { id: reviewCaseId },
            data: {
              status: "analysis_queued",
              analysisStartedAt: null,
              analysisCompletedAt: null
            },
            include: reviewInclude
          });

          return {
            reviewCaseId,
            status: "analysis_queued",
            issueCount: updated.issues.length,
            analysisHref: `/reviews/${reviewCaseId}`,
            analysisNotice: updated.analysisNotice ?? undefined,
            jobId: job.id
          };
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return undefined;
        }

        throw error;
      }
    },

    async claimNextAnalysisJob(tenantId, workerId) {
      const queued = await prisma.analysisJob.findFirst({
        where: { tenantId, status: "queued" },
        orderBy: { queuedAt: "asc" }
      });

      if (!queued) {
        return undefined;
      }

      const now = new Date();
      const claimedCount = await prisma.analysisJob.updateMany({
        where: { id: queued.id, status: "queued" },
        data: {
          status: "running",
          progress: 20,
          currentStep: "worker_running",
          startedByUserId: workerId,
          startedAt: now
        }
      });

      if (claimedCount.count === 0) {
        return undefined;
      }

      const [job, review] = await prisma.$transaction([
        prisma.analysisJob.findUniqueOrThrow({
          where: { id: queued.id }
        }),
        prisma.reviewCase.update({
          where: { id: queued.reviewCaseId },
          data: {
            status: "analysis_in_progress",
            analysisStartedAt: now
          },
          include: reviewInclude
        })
      ]);

      return {
        ...toAnalysisJob(job),
        reviewCase: toReviewCase(reviewRow(review))
      };
    },

    async completeAnalysisJob(scope, jobId, _artifacts) {
      void _artifacts;

      return prisma.$transaction(async (tx) => {
        const job = await tx.analysisJob.findFirst({
          where: {
            id: jobId,
            tenantId: scope.tenantId,
            status: { in: ["queued", "running"] },
            currentStep: "outputs_persisted"
          }
        });

        const persistedArtifacts = (job?.artifacts as AnalysisArtifacts | null) ?? undefined;

        if (!job || !persistedArtifacts) {
          return undefined;
        }

        const now = new Date();
        const completed = await tx.analysisJob.updateMany({
          where: {
            id: jobId,
            tenantId: scope.tenantId,
            status: { in: ["queued", "running"] },
            currentStep: "outputs_persisted"
          },
          data: {
            status: "completed",
            progress: 100,
            currentStep: "worker_completed",
            completedAt: now,
            artifacts: persistedArtifacts as unknown as Prisma.InputJsonValue
          }
        });

        if (completed.count !== 1) {
          return undefined;
        }

        const updated = await tx.reviewCase.update({
          where: { id: job.reviewCaseId },
          data: {
            status: "analysis_complete",
            analysisCompletedAt: now
          },
          include: reviewInclude
        });

        return {
          reviewCaseId: job.reviewCaseId,
          status: "analysis_complete",
          issueCount: updated.issues.length,
          analysisHref: `/reviews/${job.reviewCaseId}`,
          analysisNotice: updated.analysisNotice ?? undefined,
          jobId,
          extractedDocumentCount: persistedArtifacts.extractedDocuments.length,
          evidenceCandidateCount: persistedArtifacts.evidenceCandidates.length
        };
      });
    },

    async persistAnalysisOutputs(scope, input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const persistStartedAt = new Date();
          const claimedPersist = await tx.analysisJob.updateMany({
            where: {
              id: input.jobId,
              tenantId: scope.tenantId,
              reviewCaseId: input.reviewCaseId,
              status: { in: ["queued", "running"] },
              currentStep: { notIn: ["outputs_persisting", "outputs_persisted"] }
            },
            data: {
              progress: 80,
              currentStep: "outputs_persisting"
            }
          });

          if (claimedPersist.count !== 1) {
            return undefined;
          }

          const job = await tx.analysisJob.findFirst({
            where: {
              id: input.jobId,
              tenantId: scope.tenantId,
              reviewCaseId: input.reviewCaseId,
              status: { in: ["queued", "running"] },
              currentStep: "outputs_persisting"
            }
          });

          if (!job) {
            throw new AnalysisJobTransitionConflictError();
          }

          if (!job.startedAt) {
            await tx.analysisJob.update({
              where: { id: input.jobId },
              data: { startedAt: persistStartedAt }
            });
          }

          const review = await tx.reviewCase.findFirst({
            where: { id: input.reviewCaseId, tenantId: scope.tenantId },
            include: reviewInclude
          });

          if (!review) {
            throw new AnalysisJobTransitionConflictError();
          }

          const reviewCase = toReviewCase(reviewRow(review));
          const findings = findingsFromArtifacts(reviewCase, input.artifacts);
          const persistedArtifacts: AnalysisArtifacts =
            input.artifacts.findings && input.artifacts.findings.length > 0
              ? input.artifacts
              : { ...input.artifacts, findings };

          if (!review.analysisStartedAt) {
            await tx.reviewCase.update({
              where: { id: input.reviewCaseId },
              data: {
                status: "analysis_in_progress",
                analysisStartedAt: persistStartedAt
              }
            });
          }

          const reviewFileIds = new Set(review.files.map((file) => file.id));
          const reviewFileChunks = new Map<
            string,
            { id: string; knowledgeDocumentId: string | null }
          >();

          for (const document of input.artifacts.extractedDocuments) {
            if (!reviewFileIds.has(document.fileId)) {
              continue;
            }

            const chunkId = chunkIdForReviewDocument(input.reviewCaseId, document.fileId);
            const chunkData = {
              reviewFileId: document.fileId,
              chunkText: document.text,
              chunkSummary: document.fileName,
              embeddingModel: "deterministic",
              embeddingId: `embedding-${chunkId}`,
              metadata: {
                source: "review_file",
                provider: document.provider,
                storageKey: document.storageKey,
                confidence: document.confidence
              } as Prisma.InputJsonValue
            };

            await tx.evidenceChunk.upsert({
              where: { id: chunkId },
              create: {
                id: chunkId,
                tenantId: scope.tenantId,
                ...chunkData
              },
              update: chunkData
            });
            reviewFileChunks.set(chunkId, { id: chunkId, knowledgeDocumentId: null });
          }

          const candidateChunkIds = unique(
            findings.flatMap((finding) =>
              finding.evidence
                .map((evidence) => evidence.chunkId)
                .filter((chunkId): chunkId is string => Boolean(chunkId))
            )
          );
          const allowedExistingChunks =
            candidateChunkIds.length > 0
              ? await tx.evidenceChunk.findMany({
                  where: {
                    id: { in: candidateChunkIds },
                    tenantId: scope.tenantId,
                    OR: [
                      { knowledgeDocument: { is: { approvalStatus: "approved" } } },
                      { reviewFile: { is: { reviewCaseId: input.reviewCaseId } } }
                    ]
                  },
                  select: {
                    id: true,
                    knowledgeDocumentId: true,
                    knowledgeDocument: {
                      select: {
                        version: true,
                        effectiveFrom: true
                      }
                    }
                  }
                })
              : [];
          const allowedChunks = new Map([
            ...reviewFileChunks,
            ...allowedExistingChunks.map(
              (chunk) =>
                [
                  chunk.id,
                  {
                    id: chunk.id,
                    knowledgeDocumentId: chunk.knowledgeDocumentId,
                    documentVersion: chunk.knowledgeDocument?.version,
                    documentEffectiveFrom: chunk.knowledgeDocument?.effectiveFrom
                  }
                ] as const
            )
          ]);

          for (const agentType of unique(findings.map((finding) => finding.agentType))) {
            const runId = `agent-run-${input.reviewCaseId}-${input.jobId}-${agentType}`;
            const runData = {
              analysisJobId: input.jobId,
              status: "completed" as const,
              model: "deterministic",
              modelTier: "mock",
              inputSnapshot: {
                reviewCaseId: input.reviewCaseId,
                extractedDocumentCount: input.artifacts.extractedDocuments.length,
                evidenceCandidateCount: input.artifacts.evidenceCandidates.length
              } as Prisma.InputJsonValue,
              outputSnapshot: {
                findingCount: findings.filter((finding) => finding.agentType === agentType).length
              } as Prisma.InputJsonValue,
              completedAt: new Date()
            };

            await tx.agentRun.upsert({
              where: { id: runId },
              create: {
                id: runId,
                reviewCaseId: input.reviewCaseId,
                agentType,
                ...runData,
                startedAt: new Date(input.artifacts.generatedAt)
              },
              update: runData
            });
          }

          for (const [index, finding] of findings.entries()) {
            const findingId = `finding-${input.reviewCaseId}-${input.jobId}-${String(
              index + 1
            ).padStart(3, "0")}`;
            const findingData = {
              agentRunId: `agent-run-${input.reviewCaseId}-${input.jobId}-${finding.agentType}`,
              issueType: finding.issueType,
              riskLevel: finding.riskLevel,
              title: finding.title,
              targetText: finding.targetText,
              targetBbox: finding.targetBbox,
              outputSnapshot: finding as unknown as Prisma.InputJsonValue
            };

            await tx.agentFinding.upsert({
              where: { id: findingId },
              create: {
                id: findingId,
                reviewCaseId: input.reviewCaseId,
                ...findingData
              },
              update: findingData
            });
          }

          if (review.issues.length === 0) {
            for (const [index, finding] of findings.entries()) {
              const issueId = `issue-${input.reviewCaseId}-${String(index + 1).padStart(3, "0")}`;
              const findingId = `finding-${input.reviewCaseId}-${input.jobId}-${String(
                index + 1
              ).padStart(3, "0")}`;
              const issueData = {
                issueType: finding.issueType,
                riskLevel: finding.riskLevel,
                title: finding.title,
                targetText: finding.targetText,
                targetBbox: finding.targetBbox,
                targetFileId:
                  finding.evidence[0]?.sourceFileId &&
                  reviewFileIds.has(finding.evidence[0].sourceFileId)
                    ? finding.evidence[0].sourceFileId
                    : undefined,
                confidence: finding.confidence,
                agentFindingId: findingId,
                sourceAgents: [finding.agentType],
                suggestedAction: finding.suggestedAction,
                status: "open" as const,
                description: finding.description,
                suggestedCopy: finding.suggestedCopy
              };

              await tx.evidence.deleteMany({ where: { issueId } });
              await tx.reviewIssue.upsert({
                where: { id: issueId },
                create: {
                  id: issueId,
                  reviewCaseId: input.reviewCaseId,
                  ...issueData
                },
                update: issueData
              });
              const evidenceRows = evidenceCreateInput(
                input.reviewCaseId,
                issueId,
                finding,
                allowedChunks
              );

              for (const evidence of evidenceRows) {
                await tx.evidence.upsert({
                  where: { id: evidence.id },
                  create: {
                    issueId,
                    ...evidence
                  },
                  update: {
                    issueId,
                    ...evidence
                  }
                });
              }
            }
          }

          const [issueCount, evidenceCount, issueRiskRows] = await Promise.all([
            tx.reviewIssue.count({ where: { reviewCaseId: input.reviewCaseId } }),
            tx.evidence.count({ where: { issue: { reviewCaseId: input.reviewCaseId } } }),
            tx.reviewIssue.findMany({
              where: { reviewCaseId: input.reviewCaseId },
              select: { riskLevel: true }
            })
          ]);
          await tx.reviewCase.update({
            where: { id: input.reviewCaseId },
            data: {
              highestRiskLevel:
                issueRiskRows.length > 0
                  ? highestRiskLevelFrom(
                      issueRiskRows.map((issue) => issue.riskLevel),
                      "info"
                    )
                  : review.highestRiskLevel
            }
          });
          const persistedJob = await tx.analysisJob.updateMany({
            where: {
              id: input.jobId,
              tenantId: scope.tenantId,
              reviewCaseId: input.reviewCaseId,
              status: { in: ["queued", "running"] },
              currentStep: "outputs_persisting"
            },
            data: {
              progress: Math.max(job.progress, 90),
              currentStep: "outputs_persisted",
              artifacts: persistedArtifacts as Prisma.InputJsonValue
            }
          });

          if (persistedJob.count !== 1) {
            throw new AnalysisJobTransitionConflictError();
          }

          return { issueCount, evidenceCount };
        });
      } catch (error) {
        if (error instanceof AnalysisJobTransitionConflictError) {
          return undefined;
        }

        throw error;
      }
    },

    async failAnalysisJob(scope, jobId, errorMessage) {
      return prisma.$transaction(async (tx) => {
        const job = await tx.analysisJob.findFirst({
          where: {
            id: jobId,
            tenantId: scope.tenantId,
            status: { in: ["queued", "running"] },
            currentStep: { not: "outputs_persisting" }
          },
          select: { reviewCaseId: true }
        });

        if (!job) {
          return undefined;
        }

        const failedCount = await tx.analysisJob.updateMany({
          where: {
            id: jobId,
            tenantId: scope.tenantId,
            status: { in: ["queued", "running"] },
            currentStep: { not: "outputs_persisting" }
          },
          data: {
            status: "failed",
            progress: 100,
            currentStep: "worker_failed",
            completedAt: new Date(),
            errorMessage
          }
        });

        if (failedCount.count !== 1) {
          return undefined;
        }

        const failed = await tx.analysisJob.findUniqueOrThrow({
          where: { id: jobId }
        });
        await tx.reviewCase.update({
          where: { id: job.reviewCaseId },
          data: {
            status: "analysis_waiting"
          }
        });

        return toAnalysisJob(failed);
      });
    },

    async getLatestAnalysisJob(scope, reviewCaseId) {
      const row = await prisma.analysisJob.findFirst({
        where: { tenantId: scope.tenantId, reviewCaseId },
        orderBy: { queuedAt: "desc" }
      });

      return row ? toAnalysisJob(row) : undefined;
    },

    async listIssues(scope, reviewCaseId, options: ListIssuesOptions = {}) {
      const review = await getReviewCase(scope, reviewCaseId);

      if (!review) {
        return undefined;
      }

      return options.riskLevel
        ? review.issues.filter((issue) => issue.riskLevel === options.riskLevel)
        : review.issues;
    },

    async getIssue(scope, reviewCaseId, issueId) {
      const review = await getReviewCase(scope, reviewCaseId);

      return review?.issues.find((issue) => issue.id === issueId);
    },

    async getIssueEvidence(scope, issueId) {
      const issue = await prisma.reviewIssue.findFirst({
        where: { id: issueId, reviewCase: { tenantId: scope.tenantId } },
        include: { evidence: { orderBy: { id: "asc" } } }
      });

      return issue?.evidence.map((evidence) => ({
        id: evidence.id,
        sourceType: evidence.sourceType,
        documentId: evidence.documentId ?? undefined,
        chunkId: evidence.chunkId ?? undefined,
        version: evidence.version ?? undefined,
        effectiveFrom: evidence.effectiveFrom
          ? evidence.effectiveFrom.toISOString().slice(0, 10)
          : undefined,
        title: evidence.title,
        page: evidence.page ?? undefined,
        section: evidence.section ?? undefined,
        quoteSummary: evidence.quoteSummary,
        relevanceScore: evidence.relevanceScore
      }));
    },

    async saveIssueDecision(scope, input: SaveIssueDecisionInput) {
      const issue = await prisma.reviewIssue.findFirst({
        where: {
          id: input.issueId,
          reviewCaseId: input.reviewCaseId,
          reviewCase: { tenantId: scope.tenantId }
        }
      });

      if (!issue) {
        return undefined;
      }

      await prisma.reviewIssue.update({
        where: { id: input.issueId },
        data: {
          reviewerRiskLevel: input.reviewerRiskLevel,
          finalAction: input.finalAction,
          reviewerComment: input.reviewerComment,
          status: "reviewed"
        }
      });

      const review = await getReviewCase(scope, input.reviewCaseId);

      return review?.issues.find((candidate) => candidate.id === input.issueId);
    },

    async saveOpinionDraft(scope, reviewCaseId, draft) {
      const review = await prisma.reviewCase.findFirst({
        where: { id: reviewCaseId, tenantId: scope.tenantId }
      });

      if (!review) {
        return undefined;
      }

      const updated = await prisma.reviewCase.update({
        where: { id: reviewCaseId },
        data: {
          currentDraft: draft,
          currentDraftVersion: { increment: 1 }
        },
        include: reviewInclude
      });

      return toReviewCase(reviewRow(updated));
    },

    async updateReviewStatus(scope, reviewCaseId, status: FinalReviewStatus) {
      const review = await prisma.reviewCase.findFirst({
        where: { id: reviewCaseId, tenantId: scope.tenantId }
      });

      if (!review) {
        return undefined;
      }

      const updated = await prisma.reviewCase.update({
        where: { id: reviewCaseId },
        data: {
          status,
          finalDecisionAt: new Date()
        },
        include: reviewInclude
      });

      return toReviewCase(reviewRow(updated));
    },

    async recordAuditEvent(scope, input: AuditEventInput): Promise<AuditEvent> {
      const event = await prisma.auditLog.create({
        data: {
          id: `audit-${randomUUID()}`,
          tenantId: scope.tenantId,
          userId: scope.actorUserId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          beforeValue: input.beforeValue as Prisma.InputJsonValue | undefined,
          afterValue: input.afterValue as Prisma.InputJsonValue | undefined,
          ipAddress: scope.ipAddress
        }
      });

      return toAuditEvent(event);
    },

    async listAuditEvents(scope, options: ListAuditEventsOptions = {}) {
      const events = await prisma.auditLog.findMany({
        where: {
          tenantId: scope.tenantId,
          targetType: options.targetType,
          targetId: options.targetId
        },
        orderBy: { createdAt: "desc" }
      });

      return events.map(toAuditEvent);
    }
  };
}
