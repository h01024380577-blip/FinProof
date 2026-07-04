-- CreateTable
CREATE TABLE "analysis_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_events_review_case_job_seq_idx" ON "analysis_events"("review_case_id", "job_id", "seq");

-- AddForeignKey
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
