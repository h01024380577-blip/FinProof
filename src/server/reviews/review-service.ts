import { randomUUID } from "node:crypto";
import { requireRole } from "@/server/auth/rbac";
import type { RequestContext } from "@/server/auth/request-context";
import {
  createReviewAnalysisPipeline,
  type ReviewAnalysisPipeline
} from "@/server/analysis/review-analysis-pipeline";
import { getReviewStorageAdapter, type ReviewStorageAdapter } from "@/server/storage";
import {
  createKnowledgeDocumentChunks,
  extractKnowledgeDocumentText
} from "@/server/knowledge/knowledge-ingestion";
import { expandArchiveUploads } from "@/server/storage/archive-extraction";
import { getUploadScanner, type UploadScanner } from "@/server/storage/upload-security";
import type { ReviewAction, ReviewStatus, RoleId } from "@/domain/types";
import { getReviewStore } from ".";
import { StateConflictError } from "./route-utils";
import type {
  AnalysisJob,
  AuditEvent,
  CreateChatMessageInput,
  CreateChatSessionInput,
  CreateDraftVersionInput,
  CreateKnowledgeDocumentInput,
  CreateReviewReportInput,
  CreateReviewCaseFromSamplePackageInput,
  CreateReviewCaseFromUploadedFilesInput,
  FinalReviewStatus,
  ListIssuesOptions,
  ListReviewSummariesOptions,
  ReviewStore,
  ReviewStoreScope,
  SaveIssueDecisionInput
} from "./review-store";

export type AnalysisStatusResponse = {
  reviewCaseId: string;
  status: AnalysisJob["status"] | "not_started";
  progress: number;
  currentStep: string;
  jobId: string | null;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
};

type ReviewServiceDeps = {
  store?: ReviewStore;
  storage?: ReviewStorageAdapter;
  uploadScanner?: UploadScanner;
  analysisPipeline?: ReviewAnalysisPipeline;
};

let uploadReviewCaseSequence = 1;

type KnowledgeDocumentUploadFile = {
  name: string;
  type: string;
  size: number;
  body: Uint8Array;
};

export type CreateKnowledgeDocumentServiceInput = Omit<CreateKnowledgeDocumentInput, "storageKey"> &
  Partial<Pick<CreateKnowledgeDocumentInput, "storageKey">> & {
    file?: KnowledgeDocumentUploadFile;
    sourceText?: string;
  };

export type CreateKnowledgeDocumentServiceResult = {
  document: Awaited<ReturnType<ReviewStore["createKnowledgeDocument"]>>;
  ingestion: {
    chunkCount: number;
    embeddingModel: string;
  };
};

function scopeFromContext(context: RequestContext): ReviewStoreScope {
  return {
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorRole: context.role,
    ipAddress: context.ipAddress
  };
}

function nextUploadReviewCaseId() {
  const id = `rc-upload-${String(uploadReviewCaseSequence).padStart(3, "0")}`;
  uploadReviewCaseSequence += 1;

  return id;
}

function analysisExecutionMode() {
  return process.env.FINPROOF_ANALYSIS_EXECUTION_MODE === "queued" ? "queued" : "inline";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function availableActionsFor(role: RoleId, status: ReviewStatus): ReviewAction[] {
  if (status === "analysis_waiting" && (role === "reviewer" || role === "compliance_admin")) {
    return ["start_analysis"];
  }

  if (status === "analysis_complete") {
    return ["open_workbench", "view_audit"];
  }

  if (
    status === "approved" ||
    status === "change_requested" ||
    status === "rejected" ||
    status === "on_hold"
  ) {
    return ["view_audit"];
  }

  return [];
}

export function resetReviewServiceStateForTests() {
  uploadReviewCaseSequence = 1;
}

export function createReviewService(deps: ReviewServiceDeps = {}) {
  const store = deps.store ?? getReviewStore();
  const storage = deps.storage ?? getReviewStorageAdapter();
  const uploadScanner = deps.uploadScanner ?? getUploadScanner();
  const analysisPipeline =
    deps.analysisPipeline ??
    createReviewAnalysisPipeline({ fileBodyReader: storage, reviewStore: store });

  return {
    async listReviewSummaries(context: RequestContext, options: ListReviewSummariesOptions = {}) {
      const page = await store.listReviewSummaries(scopeFromContext(context), options);
      const items = page.items.map((summary) => ({
        ...summary,
        availableActions: availableActionsFor(context.role, summary.status)
      }));

      return {
        ...page,
        items,
        reviewCases: items
      };
    },

    async getReviewCase(context: RequestContext, reviewCaseId: string) {
      return store.getReviewCase(scopeFromContext(context), reviewCaseId);
    },

    async createReviewCaseFromSamplePackage(
      context: RequestContext,
      input: CreateReviewCaseFromSamplePackageInput
    ) {
      const scope = scopeFromContext(context);
      const result = await store.createReviewCaseFromSamplePackage(scope, input);

      if (result) {
        await store.recordAuditEvent(scope, {
          action: "review_case.create_from_sample",
          targetType: "review_case",
          targetId: result.reviewCase.id,
          afterValue: { status: result.reviewCase.status }
        });
      }

      return result;
    },

    async createReviewCaseFromUploadedFiles(
      context: RequestContext,
      input: Omit<CreateReviewCaseFromUploadedFilesInput, "files"> & {
        files: Array<{ name: string; type: string; size: number; body: Uint8Array }>;
      }
    ) {
      const scope = scopeFromContext(context);
      let reviewCaseId = input.reviewCaseId;

      if (reviewCaseId) {
        if (!(await store.isReviewCaseIdAvailable(scope, reviewCaseId))) {
          throw new Error("Review case id already exists");
        }
      } else {
        do {
          reviewCaseId = nextUploadReviewCaseId();
        } while (!(await store.isReviewCaseIdAvailable(scope, reviewCaseId)));
      }

      const uploadFiles = await expandArchiveUploads(input.files);
      const files = await Promise.all(
        uploadFiles.map(async (file, index) => {
          const fileId = `file-upload-${String(index + 1).padStart(3, "0")}`;
          const contentType = file.type || "application/octet-stream";
          await uploadScanner.scanReviewFile({
            reviewCaseId,
            fileId,
            fileName: file.name,
            contentType,
            sizeBytes: file.size,
            body: file.body
          });
          const metadata = await storage.putReviewFile({
            reviewCaseId,
            fileId,
            fileName: file.name,
            contentType,
            sizeBytes: file.size,
            body: file.body
          });

          return {
            id: fileId,
            name: file.name,
            type: metadata.contentType,
            size: metadata.sizeBytes,
            storageProvider: metadata.storageProvider,
            storageKey: metadata.storageKey
          };
        })
      );
      const result = await store.createReviewCaseFromUploadedFiles(scope, {
        ...input,
        reviewCaseId,
        files
      });

      await store.recordAuditEvent(scope, {
        action: "review_case.create_from_upload",
        targetType: "review_case",
        targetId: result.reviewCase.id,
        afterValue: {
          status: result.reviewCase.status,
          fileCount: result.files.length,
          missingMaterials: result.missingMaterials
        }
      });

      return result;
    },

    async startAnalysis(context: RequestContext, reviewCaseId: string) {
      requireRole(context, ["reviewer", "compliance_admin"], "start analysis");

      const scope = scopeFromContext(context);
      const before = await store.getReviewCase(scope, reviewCaseId);

      if (before && before.status !== "submitted" && before.status !== "analysis_waiting") {
        throw new StateConflictError(`Cannot start analysis while review case is ${before.status}`);
      }

      const recordAnalysisStart = async (queued: { status: string; jobId: string }) => {
        try {
          await store.recordAuditEvent(scope, {
            action: "analysis.start",
            targetType: "review_case",
            targetId: reviewCaseId,
            beforeValue: before ? { status: before.status } : undefined,
            afterValue: { status: queued.status, jobId: queued.jobId }
          });
        } catch (error) {
          try {
            await store.failAnalysisJob(
              scope,
              queued.jobId,
              `Analysis start audit failed: ${errorMessage(error)}`
            );
          } catch {
            // Preserve the original audit failure for the caller.
          }

          throw error;
        }
      };
      const recordAnalysisComplete = async (completed: {
        jobId: string;
        extractedDocumentCount?: number;
        evidenceCandidateCount?: number;
        issueCount: number;
      }) => {
        await store.recordAuditEvent(scope, {
          action: "analysis.complete",
          targetType: "review_case",
          targetId: reviewCaseId,
          afterValue: {
            jobId: completed.jobId,
            extractedDocumentCount: completed.extractedDocumentCount ?? 0,
            evidenceCandidateCount: completed.evidenceCandidateCount ?? 0,
            issueCount: completed.issueCount
          }
        });
      };

      if (analysisExecutionMode() === "queued") {
        const queued = await store.enqueueAnalysis(scope, reviewCaseId);

        if (queued) {
          await recordAnalysisStart(queued);
        }

        return queued;
      }

      const queued = await store.enqueueAnalysis(scope, reviewCaseId);

      if (queued) {
        await recordAnalysisStart(queued);
      }

      if (queued && before) {
        let result;

        try {
          const artifacts = await analysisPipeline.run({ review: before, scope });
          const persisted = await store.persistAnalysisOutputs(scope, {
            reviewCaseId,
            jobId: queued.jobId,
            artifacts
          });

          if (!persisted) {
            throw new Error(`Analysis outputs were not persisted for job ${queued.jobId}`);
          }

          const completed = await store.completeAnalysisJob(scope, queued.jobId, artifacts);

          if (!completed) {
            throw new Error(`Analysis job ${queued.jobId} was not completed`);
          }

          result = {
            ...completed,
            issueCount: persisted.issueCount
          };
        } catch (error) {
          await store.failAnalysisJob(scope, queued.jobId, errorMessage(error));
          throw error;
        }

        try {
          await recordAnalysisComplete(result);
        } catch {
          // Audit failure must not roll back completed inline analysis state.
        }

        return result;
      }

      return queued;
    },

    async getLatestAnalysisJob(context: RequestContext, reviewCaseId: string) {
      return store.getLatestAnalysisJob(scopeFromContext(context), reviewCaseId);
    },

    async getAnalysisStatus(
      context: RequestContext,
      reviewCaseId: string
    ): Promise<AnalysisStatusResponse | undefined> {
      const scope = scopeFromContext(context);
      const review = await store.getReviewCase(scope, reviewCaseId);

      if (!review) {
        return undefined;
      }

      const job = await store.getLatestAnalysisJob(scope, reviewCaseId);

      if (!job) {
        return {
          reviewCaseId,
          status: "not_started",
          progress: 0,
          currentStep: "waiting_for_reviewer",
          jobId: null
        };
      }

      return {
        reviewCaseId,
        status: job.status,
        progress: job.progress,
        currentStep: job.currentStep,
        jobId: job.id,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errorMessage: job.errorMessage
      };
    },

    async listIssues(context: RequestContext, reviewCaseId: string, options?: ListIssuesOptions) {
      return store.listIssues(scopeFromContext(context), reviewCaseId, options);
    },

    async getIssue(context: RequestContext, reviewCaseId: string, issueId: string) {
      return store.getIssue(scopeFromContext(context), reviewCaseId, issueId);
    },

    async getIssueEvidence(context: RequestContext, issueId: string) {
      return store.getIssueEvidence(scopeFromContext(context), issueId);
    },

    async saveIssueDecision(context: RequestContext, input: SaveIssueDecisionInput) {
      requireRole(context, ["reviewer", "compliance_admin"], "save issue decision");

      const scope = scopeFromContext(context);
      const before = await store.getIssue(scope, input.reviewCaseId, input.issueId);
      const issue = await store.saveIssueDecision(scope, input);

      if (issue) {
        await store.recordAuditEvent(scope, {
          action: "issue.decision.save",
          targetType: "review_issue",
          targetId: input.issueId,
          beforeValue: before
            ? {
                reviewerRiskLevel: before.reviewerRiskLevel,
                finalAction: before.finalAction,
                reviewerComment: before.reviewerComment
              }
            : undefined,
          afterValue: {
            reviewerRiskLevel: issue.reviewerRiskLevel,
            finalAction: issue.finalAction,
            reviewerComment: issue.reviewerComment
          }
        });
      }

      return issue;
    },

    async saveOpinionDraft(context: RequestContext, reviewCaseId: string, draft: string) {
      requireRole(context, ["reviewer", "compliance_admin"], "save opinion draft");

      const scope = scopeFromContext(context);
      const before = await store.getReviewCase(scope, reviewCaseId);
      const review = await store.saveOpinionDraft(scope, reviewCaseId, draft);

      if (review) {
        await store.recordAuditEvent(scope, {
          action: "draft.save",
          targetType: "review_case",
          targetId: reviewCaseId,
          beforeValue: before
            ? { currentDraftVersion: before.currentDraftVersion ?? 0 }
            : undefined,
          afterValue: { currentDraftVersion: review.currentDraftVersion ?? 0 }
        });
      }

      return review;
    },

    async updateReviewStatus(
      context: RequestContext,
      reviewCaseId: string,
      status: FinalReviewStatus
    ) {
      requireRole(context, ["reviewer", "compliance_admin"], "finalize review");

      const scope = scopeFromContext(context);
      const before = await store.getReviewCase(scope, reviewCaseId);
      const review = await store.updateReviewStatus(scope, reviewCaseId, status);

      if (review) {
        await store.recordAuditEvent(scope, {
          action: "review_case.finalize",
          targetType: "review_case",
          targetId: reviewCaseId,
          beforeValue: before ? { status: before.status } : undefined,
          afterValue: { status: review.status }
        });
      }

      return review;
    },

    async listAuditEvents(context: RequestContext, targetType?: string, targetId?: string) {
      return store.listAuditEvents(scopeFromContext(context), { targetType, targetId });
    },

    async createKnowledgeDocument(
      context: RequestContext,
      input: CreateKnowledgeDocumentServiceInput
    ): Promise<CreateKnowledgeDocumentServiceResult> {
      requireRole(context, ["reviewer", "compliance_admin"], "create knowledge document");

      const scope = scopeFromContext(context);
      const documentId = input.id ?? `knowledge-${randomUUID()}`;
      let storageKey = input.storageKey;
      let extractedText = input.sourceText;

      if (input.file) {
        const contentType = input.file.type || "application/octet-stream";
        await uploadScanner.scanReviewFile({
          reviewCaseId: "knowledge-document",
          fileId: documentId,
          fileName: input.file.name,
          contentType,
          sizeBytes: input.file.size,
          body: input.file.body
        });
        const metadata = await storage.putKnowledgeDocumentFile({
          documentId,
          fileName: input.file.name,
          contentType,
          sizeBytes: input.file.size,
          body: input.file.body
        });

        storageKey = metadata.storageKey;
        extractedText = await extractKnowledgeDocumentText({
          fileName: input.file.name,
          contentType: metadata.contentType,
          body: input.file.body
        });
      }

      const document = await store.createKnowledgeDocument(scope, {
        id: documentId,
        documentType: input.documentType,
        affiliateId: input.affiliateId,
        productType: input.productType,
        title: input.title,
        version: input.version,
        effectiveFrom: input.effectiveFrom,
        storageKey: storageKey ?? `generated/knowledge-documents/${documentId}.txt`
      });
      const chunks = await createKnowledgeDocumentChunks({
        tenantId: scope.tenantId,
        documentId: document.id,
        text: extractedText ?? `${document.title} ${document.version}`
      });
      await store.replaceKnowledgeDocumentChunks(scope, document.id, chunks);

      await store.recordAuditEvent(scope, {
        action: "knowledge_document.create",
        targetType: "knowledge_document",
        targetId: document.id,
        afterValue: {
          title: document.title,
          version: document.version,
          chunkCount: chunks.length
        }
      });

      return {
        document,
        ingestion: {
          chunkCount: chunks.length,
          embeddingModel: chunks[0]?.embeddingModel ?? "none"
        }
      };
    },

    async listKnowledgeDocuments(context: RequestContext) {
      return store.listKnowledgeDocuments(scopeFromContext(context));
    },

    async approveKnowledgeDocument(context: RequestContext, documentId: string) {
      requireRole(context, ["reviewer", "compliance_admin"], "approve knowledge document");

      const scope = scopeFromContext(context);
      const document = await store.approveKnowledgeDocument(scope, documentId);

      if (document) {
        await store.recordAuditEvent(scope, {
          action: "knowledge_document.approve",
          targetType: "knowledge_document",
          targetId: document.id,
          afterValue: { approvalStatus: document.approvalStatus }
        });
      }

      return document;
    },

    async createChatSession(context: RequestContext, input: CreateChatSessionInput) {
      requireRole(context, ["reviewer", "compliance_admin"], "create review chat session");

      return store.createChatSession(scopeFromContext(context), input);
    },

    async createChatMessage(context: RequestContext, input: CreateChatMessageInput) {
      requireRole(context, ["reviewer", "compliance_admin"], "create chat message");

      const scope = scopeFromContext(context);
      const result = await store.createChatMessage(scope, input);

      if (result) {
        await store.recordAuditEvent(scope, {
          action: "chat.message.create",
          targetType: "chat_session",
          targetId: input.sessionId,
          afterValue: {
            userMessageId: result.userMessage.id,
            assistantMessageId: result.assistantMessage.id
          }
        });
      }

      return result;
    },

    async markChatMessageForDraft(
      context: RequestContext,
      messageId: string,
      markedForDraft: boolean
    ) {
      requireRole(context, ["reviewer", "compliance_admin"], "mark chat message for draft");

      const scope = scopeFromContext(context);
      const message = await store.markChatMessageForDraft(scope, messageId, markedForDraft);

      if (message) {
        await store.recordAuditEvent(scope, {
          action: "chat.message.mark_for_draft",
          targetType: "chat_message",
          targetId: message.id,
          afterValue: { markedForDraft: message.markedForDraft }
        });
      }

      return message;
    },

    async createDraftVersion(
      context: RequestContext,
      reviewCaseId: string,
      input: CreateDraftVersionInput
    ) {
      requireRole(context, ["reviewer", "compliance_admin"], "create draft version");

      const scope = scopeFromContext(context);
      const draft = await store.createDraftVersion(scope, reviewCaseId, input);

      if (draft) {
        await store.recordAuditEvent(scope, {
          action: "draft.version.create",
          targetType: "draft_version",
          targetId: draft.id,
          afterValue: {
            reviewCaseId: draft.reviewCaseId,
            version: draft.version,
            source: draft.source
          }
        });
      }

      return draft;
    },

    async createReviewReport(
      context: RequestContext,
      reviewCaseId: string,
      input: CreateReviewReportInput
    ) {
      requireRole(context, ["reviewer", "compliance_admin"], "create review report");

      const scope = scopeFromContext(context);
      const report = await store.createReviewReport(scope, reviewCaseId, input);

      if (report) {
        await store.recordAuditEvent(scope, {
          action: "report.generate",
          targetType: "review_report",
          targetId: report.id,
          afterValue: {
            reviewCaseId: report.reviewCaseId,
            reportType: report.reportType,
            version: report.version
          }
        });
      }

      return report;
    },

    async listCaseLibrary(context: RequestContext, options: ListReviewSummariesOptions = {}) {
      requireRole(context, ["reviewer", "compliance_admin"], "list case library");

      const page = await store.listCaseLibrary(scopeFromContext(context), options);
      const items = page.items.map((summary) => ({
        ...summary,
        availableActions: availableActionsFor(context.role, summary.status)
      }));

      return {
        ...page,
        items,
        reviewCases: items
      };
    },

    async listReviewCaseAuditEvents(
      context: RequestContext,
      reviewCaseId: string
    ): Promise<AuditEvent[] | undefined> {
      const scope = scopeFromContext(context);
      const review = await store.getReviewCase(scope, reviewCaseId);

      if (!review) {
        return undefined;
      }

      return store.listAuditEvents(scope, {
        targetType: "review_case",
        targetId: reviewCaseId
      });
    }
  };
}
