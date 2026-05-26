WITH ranked_active_jobs AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "tenant_id", "review_case_id"
      ORDER BY "queued_at" DESC, "id" DESC
    ) AS "rank"
  FROM "analysis_jobs"
  WHERE "status" IN ('queued'::"AnalysisJobStatus", 'running'::"AnalysisJobStatus")
)
UPDATE "analysis_jobs"
SET
  "status" = 'failed'::"AnalysisJobStatus",
  "progress" = 100,
  "current_step" = 'worker_failed',
  "completed_at" = COALESCE("completed_at", CURRENT_TIMESTAMP),
  "error_message" = COALESCE(
    "error_message",
    'Superseded by active analysis job uniqueness migration.'
  )
WHERE "id" IN (
  SELECT "id"
  FROM ranked_active_jobs
  WHERE "rank" > 1
);

CREATE UNIQUE INDEX "analysis_jobs_one_active_per_review_case_idx"
ON "analysis_jobs"("tenant_id", "review_case_id")
WHERE "status" IN ('queued'::"AnalysisJobStatus", 'running'::"AnalysisJobStatus");
