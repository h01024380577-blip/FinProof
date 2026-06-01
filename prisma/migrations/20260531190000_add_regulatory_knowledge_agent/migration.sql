-- CreateEnum
CREATE TYPE "KnowledgeLifecycleStatus" AS ENUM ('active', 'superseded', 'inactive');

-- CreateEnum
CREATE TYPE "EvidenceChunkStatus" AS ENUM ('active', 'superseded', 'inactive');

-- CreateEnum
CREATE TYPE "RegulatorySourceType" AS ENUM ('regulator', 'law_portal', 'association', 'internal_policy_repo', 'case_knowledge');

-- CreateEnum
CREATE TYPE "RegulatorySourceStatus" AS ENUM ('active', 'paused', 'failing');

-- CreateEnum
CREATE TYPE "RegulatorySnapshotFetchStatus" AS ENUM ('fetched', 'unchanged', 'failed');

-- CreateEnum
CREATE TYPE "RegulatoryChangeType" AS ENUM ('created', 'amended', 'deleted', 'wording_changed', 'effective_date_changed', 'scope_changed', 'interpretation_changed');

-- CreateEnum
CREATE TYPE "RegulatoryRiskImpactLevel" AS ENUM ('info', 'caution', 'high', 'critical');

-- CreateEnum
CREATE TYPE "QualityGateType" AS ENUM ('citation_coverage', 'schema_validation', 'contradiction_check', 'retrieval_regression', 'effective_date', 'rollback_ready');

-- CreateEnum
CREATE TYPE "QualityGateStatus" AS ENUM ('passed', 'failed', 'flagged');

-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN "canonical_key" TEXT,
ADD COLUMN "source_snapshot_id" TEXT,
ADD COLUMN "change_set_id" TEXT,
ADD COLUMN "supersedes_document_id" TEXT,
ADD COLUMN "lifecycle_status" "KnowledgeLifecycleStatus" NOT NULL DEFAULT 'active',
ADD COLUMN "auto_ingested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "source_published_at" DATE,
ADD COLUMN "interpretation_summary" TEXT;

-- AlterTable
ALTER TABLE "evidence_chunks" ADD COLUMN "canonical_section_key" TEXT,
ADD COLUMN "section_number" TEXT,
ADD COLUMN "change_set_id" TEXT,
ADD COLUMN "supersedes_chunk_id" TEXT,
ADD COLUMN "chunk_status" "EvidenceChunkStatus" NOT NULL DEFAULT 'active',
ADD COLUMN "impact_tags" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "effective_from" DATE,
ADD COLUMN "effective_to" DATE,
ADD COLUMN "source_reliability" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "regulatory_sources" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_type" "RegulatorySourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "repository_path" TEXT,
    "polling_schedule" TEXT NOT NULL,
    "trust_level" TEXT NOT NULL,
    "last_checked_at" TIMESTAMP(3),
    "status" "RegulatorySourceStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_snapshots" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_url" TEXT,
    "title" TEXT NOT NULL,
    "published_at" DATE,
    "effective_from" DATE,
    "content_hash" TEXT NOT NULL,
    "raw_storage_key" TEXT NOT NULL,
    "normalized_storage_key" TEXT NOT NULL,
    "detected_document_type" "KnowledgeDocumentType" NOT NULL,
    "fetch_status" "RegulatorySnapshotFetchStatus" NOT NULL,
    "normalization_confidence" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_change_sets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "previous_snapshot_id" TEXT,
    "new_snapshot_id" TEXT NOT NULL,
    "change_type" "RegulatoryChangeType" NOT NULL,
    "change_summary" TEXT NOT NULL,
    "changed_sections" JSONB NOT NULL,
    "effective_from" DATE,
    "risk_impact_level" "RegulatoryRiskImpactLevel" NOT NULL,
    "interpretation_summary" TEXT NOT NULL,
    "mapped_product_types" JSONB NOT NULL,
    "mapped_channels" JSONB NOT NULL,
    "mapped_review_categories" JSONB NOT NULL,
    "quality_gate_status" "QualityGateStatus" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "created_knowledge_document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_change_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_gate_results" (
    "id" TEXT NOT NULL,
    "change_set_id" TEXT NOT NULL,
    "gate_type" "QualityGateType" NOT NULL,
    "status" "QualityGateStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_gate_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_canonical_lifecycle_idx" ON "knowledge_documents"("tenant_id", "canonical_key", "lifecycle_status");

-- CreateIndex
CREATE INDEX "knowledge_documents_change_set_idx" ON "knowledge_documents"("change_set_id");

-- CreateIndex
CREATE INDEX "evidence_chunks_tenant_change_set_idx" ON "evidence_chunks"("tenant_id", "change_set_id");

-- CreateIndex
CREATE INDEX "evidence_chunks_tenant_status_effective_idx" ON "evidence_chunks"("tenant_id", "chunk_status", "effective_from");

-- CreateIndex
CREATE INDEX "regulatory_sources_tenant_type_status_idx" ON "regulatory_sources"("tenant_id", "source_type", "status");

-- CreateIndex
CREATE INDEX "regulatory_snapshots_tenant_source_created_idx" ON "regulatory_snapshots"("tenant_id", "source_id", "created_at");

-- CreateIndex
CREATE INDEX "regulatory_change_sets_tenant_source_created_idx" ON "regulatory_change_sets"("tenant_id", "source_id", "created_at");

-- CreateIndex
CREATE INDEX "regulatory_change_sets_tenant_gate_created_idx" ON "regulatory_change_sets"("tenant_id", "quality_gate_status", "created_at");

-- CreateIndex
CREATE INDEX "quality_gate_results_change_set_gate_idx" ON "quality_gate_results"("change_set_id", "gate_type");

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_snapshot_id_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "regulatory_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "regulatory_change_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_supersedes_document_id_fkey" FOREIGN KEY ("supersedes_document_id") REFERENCES "knowledge_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_chunks" ADD CONSTRAINT "evidence_chunks_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "regulatory_change_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_chunks" ADD CONSTRAINT "evidence_chunks_supersedes_chunk_id_fkey" FOREIGN KEY ("supersedes_chunk_id") REFERENCES "evidence_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_sources" ADD CONSTRAINT "regulatory_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_snapshots" ADD CONSTRAINT "regulatory_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_snapshots" ADD CONSTRAINT "regulatory_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "regulatory_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_change_sets" ADD CONSTRAINT "regulatory_change_sets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_change_sets" ADD CONSTRAINT "regulatory_change_sets_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "regulatory_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_change_sets" ADD CONSTRAINT "regulatory_change_sets_previous_snapshot_id_fkey" FOREIGN KEY ("previous_snapshot_id") REFERENCES "regulatory_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_change_sets" ADD CONSTRAINT "regulatory_change_sets_new_snapshot_id_fkey" FOREIGN KEY ("new_snapshot_id") REFERENCES "regulatory_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_gate_results" ADD CONSTRAINT "quality_gate_results_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "regulatory_change_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
