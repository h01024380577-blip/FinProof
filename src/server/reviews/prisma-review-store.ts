import { randomUUID } from "node:crypto";
import { getRequiredMaterialRows } from "@/domain/intake";
import { classifyUploadFile } from "@/domain/upload-policy";
import type { ReviewCase, ReviewFile } from "@/domain/types";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/server/db/prisma";
import type { AnalysisArtifacts } from "@/server/analysis/review-analysis-pipeline";
import { buildAnalysisIssues, highestRiskLevelForIssues } from "@/server/analysis/issue-generation";
import { toReviewCase, toReviewSummary, type PrismaReviewCaseRow } from "./prisma-mappers";
import type {
  AnalysisJob,
  AuditEvent,
  AuditEventInput,
  CreateReviewCaseFromUploadedFilesInput,
  CreateReviewCaseFromSamplePackageInput,
  CreateReviewCaseResult,
  FinalReviewStatus,
  ListAuditEventsOptions,
  ListIssuesOptions,
  ReviewStore,
  ReviewStoreScope,
  SaveIssueDecisionInput
} from "./review-store";

const reviewInclude = {
  files: true,
  issues: {
    include: {
      evidence: true
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

function issueCreateData(issue: ReviewCase["issues"][number]) {
  return {
    id: issue.id,
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    reviewerRiskLevel: issue.reviewerRiskLevel,
    title: issue.title,
    targetText: issue.targetText,
    targetBbox: issue.targetBbox,
    sourceAgents: issue.sourceAgents,
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
        title: evidence.title,
        page: evidence.page,
        section: evidence.section,
        quoteSummary: evidence.quoteSummary,
        relevanceScore: evidence.relevanceScore
      }))
    }
  };
}

function buildGeneratedIssues(row: unknown, artifacts: AnalysisArtifacts) {
  const review = toReviewCase(reviewRow(row));

  return review.issues.length > 0 ? [] : buildAnalysisIssues(review, artifacts);
}

export function createPrismaReviewStore(): ReviewStore {
  const prisma = getPrismaClient();

  async function ensureActor(scope: ReviewStoreScope) {
    await prisma.tenant.upsert({
      where: { id: scope.tenantId },
      update: {},
      create: {
        id: scope.tenantId,
        name: scope.tenantId
      }
    });
    await prisma.user.upsert({
      where: { id: scope.actorUserId },
      update: {
        role: scope.actorRole,
        status: "active"
      },
      create: {
        id: scope.actorUserId,
        tenantId: scope.tenantId,
        email: `${scope.actorUserId}@finproof.local`,
        name: scope.actorUserId,
        role: scope.actorRole
      }
    });
  }

  async function ensureReviewer(tenantId: string, reviewerId: string | null) {
    if (!reviewerId) {
      return;
    }

    await prisma.user.upsert({
      where: { id: reviewerId },
      update: {
        role: "reviewer",
        status: "active"
      },
      create: {
        id: reviewerId,
        tenantId,
        email: `${reviewerId}@finproof.local`,
        name: reviewerId,
        role: "reviewer"
      }
    });
  }

  async function getReviewCase(scope: ReviewStoreScope, id: string) {
    const row = await prisma.reviewCase.findFirst({
      where: { id, tenantId: scope.tenantId },
      include: reviewInclude
    });

    return row ? toReviewCase(reviewRow(row)) : undefined;
  }

  return {
    async listReviewSummaries(scope) {
      const rows = await prisma.reviewCase.findMany({
        where: { tenantId: scope.tenantId },
        include: reviewInclude,
        orderBy: { updatedAt: "desc" }
      });

      return rows.map((row) => toReviewSummary(reviewRow(row)));
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
      await ensureActor(scope);

      const id = input.reviewCaseId ?? `rc-${randomUUID()}`;
      const defaultReviewerId = process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID?.trim() || null;
      await ensureReviewer(scope.tenantId, defaultReviewerId);
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
          affiliateName: input.affiliate,
          title: input.title,
          productType: input.productType,
          channelType: input.channelType,
          plannedPublishDate: plannedDate(input.plannedPublishDate),
          status: "analysis_waiting",
          highestRiskLevel: "info",
          requesterId: scope.actorUserId,
          reviewerId: defaultReviewerId,
          requesterName: scope.actorUserId,
          reviewerName: defaultReviewerId ? "준법심의자 박민준" : "미배정",
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
      await ensureActor(scope);

      const review = await prisma.reviewCase.findFirst({
        where: { id: reviewCaseId, tenantId: scope.tenantId },
        include: reviewInclude
      });

      if (!review) {
        return undefined;
      }

      const now = new Date();
      const generatedIssues = options.artifacts
        ? buildGeneratedIssues(review, options.artifacts)
        : [];
      const job = await prisma.analysisJob.create({
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
      const updated = await prisma.reviewCase.update({
        where: { id: reviewCaseId },
        data: {
          status: "analysis_complete",
          highestRiskLevel: highestRiskLevelForIssues(review.highestRiskLevel, generatedIssues),
          analysisStartedAt: now,
          analysisCompletedAt: now,
          ...(generatedIssues.length > 0
            ? {
                issues: {
                  create: generatedIssues.map(issueCreateData)
                }
              }
            : {})
        },
        include: reviewInclude
      });

      return {
        reviewCaseId,
        status: "analysis_complete",
        issueCount: updated.issues.length,
        analysisHref: `/reviews/${reviewCaseId}`,
        analysisNotice: updated.analysisNotice ?? undefined,
        jobId: job.id,
        extractedDocumentCount: options.artifacts?.extractedDocuments.length,
        evidenceCandidateCount: options.artifacts?.evidenceCandidates.length
      };
    },

    async enqueueAnalysis(scope, reviewCaseId) {
      await ensureActor(scope);

      const review = await prisma.reviewCase.findFirst({
        where: { id: reviewCaseId, tenantId: scope.tenantId },
        include: reviewInclude
      });

      if (!review) {
        return undefined;
      }

      const [job, updated] = await prisma.$transaction([
        prisma.analysisJob.create({
          data: {
            id: `job-${randomUUID()}`,
            tenantId: scope.tenantId,
            reviewCaseId,
            status: "queued",
            progress: 0,
            currentStep: "queued",
            startedByUserId: scope.actorUserId
          }
        }),
        prisma.reviewCase.update({
          where: { id: reviewCaseId },
          data: {
            status: "analysis_queued",
            analysisStartedAt: null,
            analysisCompletedAt: null
          },
          include: reviewInclude
        })
      ]);

      return {
        reviewCaseId,
        status: "analysis_queued",
        issueCount: updated.issues.length,
        analysisHref: `/reviews/${reviewCaseId}`,
        analysisNotice: updated.analysisNotice ?? undefined,
        jobId: job.id
      };
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

    async completeAnalysisJob(scope, jobId, artifacts) {
      await ensureActor(scope);

      const job = await prisma.analysisJob.findFirst({
        where: { id: jobId, tenantId: scope.tenantId }
      });

      if (!job) {
        return undefined;
      }

      const review = await prisma.reviewCase.findFirst({
        where: { id: job.reviewCaseId, tenantId: scope.tenantId },
        include: reviewInclude
      });

      if (!review) {
        return undefined;
      }

      const now = new Date();
      const generatedIssues = buildGeneratedIssues(review, artifacts);
      const [, updated] = await prisma.$transaction([
        prisma.analysisJob.update({
          where: { id: jobId },
          data: {
            status: "completed",
            progress: 100,
            currentStep: "worker_completed",
            completedAt: now,
            artifacts: artifacts as Prisma.InputJsonValue
          }
        }),
        prisma.reviewCase.update({
          where: { id: job.reviewCaseId },
          data: {
            status: "analysis_complete",
            highestRiskLevel: highestRiskLevelForIssues(review.highestRiskLevel, generatedIssues),
            analysisCompletedAt: now,
            ...(generatedIssues.length > 0
              ? {
                  issues: {
                    create: generatedIssues.map(issueCreateData)
                  }
                }
              : {})
          },
          include: reviewInclude
        })
      ]);

      return {
        reviewCaseId: job.reviewCaseId,
        status: "analysis_complete",
        issueCount: updated.issues.length,
        analysisHref: `/reviews/${job.reviewCaseId}`,
        analysisNotice: updated.analysisNotice ?? undefined,
        jobId,
        extractedDocumentCount: artifacts.extractedDocuments.length,
        evidenceCandidateCount: artifacts.evidenceCandidates.length
      };
    },

    async failAnalysisJob(scope, jobId, errorMessage) {
      await ensureActor(scope);

      const job = await prisma.analysisJob.findFirst({
        where: { id: jobId, tenantId: scope.tenantId }
      });

      if (!job) {
        return undefined;
      }

      const [failed] = await prisma.$transaction([
        prisma.analysisJob.update({
          where: { id: jobId },
          data: {
            status: "failed",
            progress: 100,
            currentStep: "worker_failed",
            completedAt: new Date(),
            errorMessage
          }
        }),
        prisma.reviewCase.update({
          where: { id: job.reviewCaseId },
          data: {
            status: "analysis_waiting"
          }
        })
      ]);

      return toAnalysisJob(failed);
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
        include: { evidence: true }
      });

      return issue?.evidence.map((evidence) => ({
        id: evidence.id,
        sourceType: evidence.sourceType,
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
      await ensureActor(scope);

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
