import type { ReviewStore, ReviewStoreScope } from "@/server/reviews";
import { getReviewStore } from "@/server/reviews";
import {
  createReviewAnalysisPipeline,
  type ReviewAnalysisPipeline
} from "./review-analysis-pipeline";

type AnalysisWorkerDeps = {
  store?: ReviewStore;
  pipeline?: ReviewAnalysisPipeline;
};

type RunOnceInput = {
  tenantId: string;
  workerId: string;
};

type RunOnceResult =
  | {
      processed: true;
      jobId: string;
      reviewCaseId: string;
      status: "completed" | "failed";
    }
  | {
      processed: false;
    };

function workerScope({ tenantId, workerId }: RunOnceInput): ReviewStoreScope {
  return {
    tenantId,
    actorUserId: workerId,
    actorRole: "compliance_admin"
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createAnalysisWorker(deps: AnalysisWorkerDeps = {}) {
  const store = deps.store ?? getReviewStore();
  const pipeline = deps.pipeline ?? createReviewAnalysisPipeline({ reviewStore: store });

  return {
    async runOnce(input: RunOnceInput): Promise<RunOnceResult> {
      const claimed = await store.claimNextAnalysisJob(input.tenantId, input.workerId);

      if (!claimed) {
        return { processed: false };
      }

      const scope = workerScope(input);
      let artifacts;

      try {
        artifacts = await pipeline.run({ review: claimed.reviewCase, scope });
        const persisted = await store.persistAnalysisOutputs(scope, {
          reviewCaseId: claimed.reviewCaseId,
          jobId: claimed.id,
          artifacts
        });

        if (!persisted) {
          throw new Error(`Analysis outputs were not persisted for job ${claimed.id}`);
        }

        const completed = await store.completeAnalysisJob(scope, claimed.id, artifacts);

        if (!completed) {
          throw new Error(`Analysis job ${claimed.id} was not completed`);
        }
      } catch (error) {
        await store.failAnalysisJob(scope, claimed.id, errorMessage(error));

        return {
          processed: true,
          jobId: claimed.id,
          reviewCaseId: claimed.reviewCaseId,
          status: "failed"
        };
      }

      try {
        await store.recordAuditEvent(scope, {
          action: "analysis.complete",
          targetType: "review_case",
          targetId: claimed.reviewCaseId,
          afterValue: {
            jobId: claimed.id,
            extractedDocumentCount: artifacts.extractedDocuments.length,
            evidenceCandidateCount: artifacts.evidenceCandidates.length,
            findingCount: artifacts.findings?.length ?? artifacts.agentFindings?.length ?? 0
          }
        });
      } catch {
        // Audit failure must not roll back completed analysis state.
      }

      return {
        processed: true,
        jobId: claimed.id,
        reviewCaseId: claimed.reviewCaseId,
        status: "completed"
      };
    }
  };
}
