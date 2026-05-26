import { requireRole } from "@/server/auth/rbac";
import type { RequestContext } from "@/server/auth/request-context";
import {
  createReviewAnalysisPipeline,
  type ReviewAnalysisPipeline
} from "@/server/analysis/review-analysis-pipeline";
import { getReviewStorageAdapter, type ReviewStorageAdapter } from "@/server/storage";
import { expandArchiveUploads } from "@/server/storage/archive-extraction";
import { getUploadScanner, type UploadScanner } from "@/server/storage/upload-security";
import type { ReviewAction, ReviewStatus, RoleId } from "@/domain/types";
import { getReviewStore } from ".";
import type {
  AnalysisJob,
  AuditEvent,
  CreateReviewCaseFromSamplePackageInput,
  CreateReviewCaseFromUploadedFilesInput,
  FinalReviewStatus,
  ListIssuesOptions,
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
  const analysisPipeline = deps.analysisPipeline ?? createReviewAnalysisPipeline();

  return {
    async listReviewSummaries(context: RequestContext) {
      const summaries = await store.listReviewSummaries(scopeFromContext(context));

      return summaries.map((summary) => ({
        ...summary,
        availableActions: availableActionsFor(context.role, summary.status)
      }));
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
      const reviewCaseId = input.reviewCaseId ?? nextUploadReviewCaseId();
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
      const result =
        analysisExecutionMode() === "queued"
          ? await store.enqueueAnalysis(scope, reviewCaseId)
          : await store.startAnalysis(scope, reviewCaseId, {
              artifacts: before ? await analysisPipeline.run({ review: before }) : undefined
            });

      if (result) {
        await store.recordAuditEvent(scope, {
          action: "analysis.start",
          targetType: "review_case",
          targetId: reviewCaseId,
          beforeValue: before ? { status: before.status } : undefined,
          afterValue: { status: result.status, jobId: result.jobId }
        });
      }

      return result;
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
