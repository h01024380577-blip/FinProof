-- CreateEnum
CREATE TYPE "KnowledgeDocumentType" AS ENUM ('law', 'internal_policy', 'checklist', 'guide');

-- CreateEnum
CREATE TYPE "KnowledgeApprovalStatus" AS ENUM ('draft', 'approved', 'inactive');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('main', 'creative', 'product_terms', 'regulation', 'internal_policy', 'case_search');

-- CreateEnum
CREATE TYPE "ChatMode" AS ENUM ('issue', 'case', 'similar_case', 'draft');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "DraftSource" AS ENUM ('generated', 'manual', 'fallback');

-- AlterTable
ALTER TABLE "review_issues"
ADD COLUMN "target_file_id" TEXT,
ADD COLUMN "target_page" INTEGER,
ADD COLUMN "confidence" DOUBLE PRECISION,
ADD COLUMN "agent_finding_id" TEXT;

-- AlterTable
ALTER TABLE "evidence"
ADD COLUMN "document_id" TEXT,
ADD COLUMN "chunk_id" TEXT,
ADD COLUMN "version" TEXT,
ADD COLUMN "effective_from" DATE;

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "affiliate_id" TEXT,
    "document_type" "KnowledgeDocumentType" NOT NULL,
    "product_type" "ProductType",
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "approval_status" "KnowledgeApprovalStatus" NOT NULL DEFAULT 'draft',
    "storage_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_chunks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "knowledge_document_id" TEXT,
    "review_file_id" TEXT,
    "chunk_text" TEXT NOT NULL,
    "chunk_summary" TEXT,
    "embedding_model" TEXT NOT NULL,
    "embedding_id" TEXT NOT NULL,
    "page" INTEGER,
    "section" TEXT,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "analysis_job_id" TEXT,
    "agent_type" "AgentType" NOT NULL,
    "status" "AgentRunStatus" NOT NULL,
    "model" TEXT NOT NULL,
    "model_tier" TEXT NOT NULL,
    "escalation_reason" TEXT,
    "input_snapshot" JSONB NOT NULL,
    "output_snapshot" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_findings" (
    "id" TEXT NOT NULL,
    "agent_run_id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "issue_type" TEXT NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "target_text" TEXT NOT NULL,
    "target_bbox" JSONB NOT NULL,
    "output_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "issue_id" TEXT,
    "user_id" TEXT NOT NULL,
    "mode" "ChatMode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "chat_session_id" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "evidence_ids" JSONB NOT NULL,
    "marked_for_draft" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_versions" (
    "id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "draft" TEXT NOT NULL,
    "source" "DraftSource" NOT NULL,
    "source_message_ids" JSONB NOT NULL,
    "evidence_ids" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" TEXT NOT NULL,
    "review_case_id" TEXT NOT NULL,
    "report_type" "SuggestedAction" NOT NULL,
    "content_markdown" TEXT NOT NULL,
    "evidence_ids" JSONB NOT NULL,
    "storage_key" TEXT,
    "version" INTEGER NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_doc_product_status_idx" ON "knowledge_documents"("tenant_id", "document_type", "product_type", "approval_status");

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_affiliate_status_idx" ON "knowledge_documents"("tenant_id", "affiliate_id", "approval_status");

-- CreateIndex
CREATE INDEX "evidence_chunks_tenant_knowledge_document_idx" ON "evidence_chunks"("tenant_id", "knowledge_document_id");

-- CreateIndex
CREATE INDEX "evidence_chunks_tenant_review_file_idx" ON "evidence_chunks"("tenant_id", "review_file_id");

-- CreateIndex
CREATE INDEX "agent_runs_review_case_agent_type_status_idx" ON "agent_runs"("review_case_id", "agent_type", "status");

-- CreateIndex
CREATE INDEX "agent_runs_analysis_job_id_idx" ON "agent_runs"("analysis_job_id");

-- CreateIndex
CREATE INDEX "agent_findings_review_case_risk_level_idx" ON "agent_findings"("review_case_id", "risk_level");

-- CreateIndex
CREATE INDEX "chat_sessions_review_case_mode_created_at_idx" ON "chat_sessions"("review_case_id", "mode", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_chat_session_created_at_idx" ON "chat_messages"("chat_session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "draft_versions_review_case_id_version_key" ON "draft_versions"("review_case_id", "version");

-- CreateIndex
CREATE INDEX "draft_versions_review_case_created_at_idx" ON "draft_versions"("review_case_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_review_case_id_version_key" ON "review_reports"("review_case_id", "version");

-- CreateIndex
CREATE INDEX "review_reports_review_case_created_at_idx" ON "review_reports"("review_case_id", "created_at");

-- AddForeignKey
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_agent_finding_id_fkey" FOREIGN KEY ("agent_finding_id") REFERENCES "agent_findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "evidence_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_chunks" ADD CONSTRAINT "evidence_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_chunks" ADD CONSTRAINT "evidence_chunks_knowledge_document_id_fkey" FOREIGN KEY ("knowledge_document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_chunks" ADD CONSTRAINT "evidence_chunks_review_file_id_fkey" FOREIGN KEY ("review_file_id") REFERENCES "review_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "analysis_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_findings" ADD CONSTRAINT "agent_findings_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_findings" ADD CONSTRAINT "agent_findings_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "review_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_session_id_fkey" FOREIGN KEY ("chat_session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
