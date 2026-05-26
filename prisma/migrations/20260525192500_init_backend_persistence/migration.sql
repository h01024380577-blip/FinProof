-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleId" AS ENUM ('requester', 'reviewer', 'compliance_admin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('draft', 'submitted', 'parsing', 'analysis_waiting', 'analysis_queued', 'analysis_in_progress', 'analysis_complete', 'under_review', 'change_requested', 'rejected', 'approved', 'on_hold', 'archived');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('deposit', 'loan', 'card', 'capital', 'insurance', 'investment');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('info', 'caution', 'high', 'reject_recommended');

-- CreateEnum
CREATE TYPE "ReviewFileType" AS ENUM ('promotional_creative', 'copy_draft', 'product_description', 'terms', 'rate_table', 'checklist', 'url_list', 'package_archive', 'misc');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('pending', 'parsed', 'failed');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('open', 'reviewed', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "SuggestedAction" AS ENUM ('approve', 'change_request', 'reject', 'hold');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('law', 'internal_policy', 'product_doc', 'case_history');

-- CreateEnum
CREATE TYPE "AnalysisJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "RoleId" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "affiliate_id" TEXT,
    "affiliate_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "product_type" "ProductType" NOT NULL,
    "channel_type" JSONB NOT NULL,
    "planned_publish_date" DATE,
    "status" "ReviewStatus" NOT NULL,
    "highest_risk_level" "RiskLevel" NOT NULL DEFAULT 'info',
    "requester_id" TEXT NOT NULL,
    "reviewer_id" TEXT,
    "requester_name" TEXT NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "promotional_copy" TEXT NOT NULL,
    "disclosure" TEXT NOT NULL,
    "product_description" TEXT NOT NULL,
    "missing_materials" JSONB NOT NULL,
    "expected_draft" TEXT NOT NULL,
    "current_draft" TEXT,
    "current_draft_version" INTEGER NOT NULL DEFAULT 0,
    "analysis_notice" TEXT,
    "submitted_at" TIMESTAMP(3),
    "analysis_started_at" TIMESTAMP(3),
    "analysis_completed_at" TIMESTAMP(3),
    "final_decision_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_files" (
    "id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "file_type" "ReviewFileType" NOT NULL,
    "classification_confidence" DOUBLE PRECISION NOT NULL,
    "parse_status" "ParseStatus" NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_issues" (
    "id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "issue_type" TEXT NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "reviewer_risk_level" "RiskLevel",
    "title" TEXT NOT NULL,
    "target_text" TEXT NOT NULL,
    "target_bbox" JSONB NOT NULL,
    "source_agents" JSONB NOT NULL,
    "suggested_action" "SuggestedAction" NOT NULL,
    "final_action" "SuggestedAction",
    "reviewer_comment" TEXT,
    "status" "IssueStatus" NOT NULL,
    "description" TEXT NOT NULL,
    "suggested_copy" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "source_type" "EvidenceSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "page" INTEGER,
    "section" TEXT,
    "quote_summary" TEXT NOT NULL,
    "relevance_score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_jobs" (
    "id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" "AnalysisJobStatus" NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "current_step" TEXT NOT NULL,
    "started_by_user_id" TEXT,
    "error_message" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "analysis_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "before_value" JSONB,
    "after_value" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_tenant_id_code_key" ON "affiliates"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_role_idx" ON "users"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "review_cases_tenant_id_status_updated_at_idx" ON "review_cases"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "review_cases_affiliate_id_product_type_status_idx" ON "review_cases"("affiliate_id", "product_type", "status");

-- CreateIndex
CREATE INDEX "review_files_review_case_id_file_type_idx" ON "review_files"("review_case_id", "file_type");

-- CreateIndex
CREATE INDEX "review_issues_review_case_id_risk_level_idx" ON "review_issues"("review_case_id", "risk_level");

-- CreateIndex
CREATE INDEX "review_issues_issue_type_risk_level_idx" ON "review_issues"("issue_type", "risk_level");

-- CreateIndex
CREATE INDEX "evidence_issue_id_source_type_idx" ON "evidence"("issue_id", "source_type");

-- CreateIndex
CREATE INDEX "analysis_jobs_tenant_id_status_queued_at_idx" ON "analysis_jobs"("tenant_id", "status", "queued_at");

-- CreateIndex
CREATE INDEX "analysis_jobs_review_case_id_queued_at_idx" ON "analysis_jobs"("review_case_id", "queued_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_target_type_target_id_created_at_idx" ON "audit_logs"("tenant_id", "target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_action_created_at_idx" ON "audit_logs"("tenant_id", "action", "created_at");

-- AddForeignKey
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cases" ADD CONSTRAINT "review_cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cases" ADD CONSTRAINT "review_cases_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cases" ADD CONSTRAINT "review_cases_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cases" ADD CONSTRAINT "review_cases_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_files" ADD CONSTRAINT "review_files_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "review_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
