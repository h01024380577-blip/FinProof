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

export function createAnalysisWorker({
  store = getReviewStore(),
  pipeline = createReviewAnalysisPipeline()
}: AnalysisWorkerDeps = {}) {
  return {
    async runOnce(input: RunOnceInput): Promise<RunOnceResult> {
      const claimed = await store.claimNextAnalysisJob(input.tenantId, input.workerId);

      if (!claimed) {
        return { processed: false };
      }

      const scope = workerScope(input);

      try {
        const artifacts = await pipeline.run({ review: claimed.reviewCase });
        await store.completeAnalysisJob(scope, claimed.id, artifacts);

        return {
          processed: true,
          jobId: claimed.id,
          reviewCaseId: claimed.reviewCaseId,
          status: "completed"
        };
      } catch (error) {
        await store.failAnalysisJob(scope, claimed.id, errorMessage(error));

        return {
          processed: true,
          jobId: claimed.id,
          reviewCaseId: claimed.reviewCaseId,
          status: "failed"
        };
      }
    }
  };
}
