-- AlterEnum
ALTER TYPE "ReviewStatus" ADD VALUE 'analysis_failed';

-- AlterTable
ALTER TABLE "review_cases" ADD COLUMN "current_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "review_versions" (
    "id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "ReviewStatus" NOT NULL,
    "reviewer_comment" TEXT,
    "opinion_draft" TEXT,
    "issues_snapshot" JSONB NOT NULL,
    "files_snapshot" JSONB NOT NULL,
    "decided_by_user_id" TEXT NOT NULL,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_certificates" (
    "id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "certificate_number" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "issued_by_user_id" TEXT NOT NULL,
    "issued_by_name" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_versions_review_case_id_version_number_idx" ON "review_versions"("review_case_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "review_versions_review_case_id_version_number_key" ON "review_versions"("review_case_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "review_certificates_review_case_id_key" ON "review_certificates"("review_case_id");

-- AddForeignKey
ALTER TABLE "review_versions" ADD CONSTRAINT "review_versions_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_certificates" ADD CONSTRAINT "review_certificates_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
