import type {
  ChatMessage,
  ChatMode,
  ChatSession,
  DraftVersion,
  Evidence,
  EvidenceChunk,
  KnowledgeDocument,
  PaginatedResult,
  PersistedReviewReport,
  ProductType,
  QualityGateResult,
  QualityGateStatus,
  RegulatoryChangeSet,
  RegulatorySnapshot,
  RegulatorySource,
  RoleId,
  ReviewCase,
  ReviewCertificate,
  ReviewCertificateStatus,
  ReviewFile,
  ReviewIssue,
  ReviewSummary,
  ReviewVersion,
  RiskLevel
} from "@/domain/types";
import type { ReviewDocumentExtraction } from "@/domain/revision-diff";
import type {
  AnalysisArtifacts,
  ExtractedDocument
} from "@/server/analysis/review-analysis-pipeline";

export type ReviewStoreScope = {
  tenantId: string;
  actorUserId: string;
  actorUserName?: string;
  actorRole: RoleId;
  ipAddress?: string;
};

export type CreateReviewCaseFromSamplePackageInput = {
  samplePackageId: string;
};

export type CreateReviewCaseResult = {
  reviewCase: ReviewCase;
  files: ReviewCase["files"];
  missingMaterials: string[];
  analysisStartHref: string;
};

export type UploadedFileInput = {
  id?: string;
  name: string;
  type: string;
  size: number;
  storageProvider?: NonNullable<ReviewFile["storageProvider"]>;
  storageKey?: string;
};

export type CreateReviewCaseFromUploadedFilesInput = {
  reviewCaseId?: string;
  title: string;
  affiliate: string;
  requestDepartment?: string;
  requestMemo?: string;
  productType: ProductType;
  channelType: string[];
  plannedPublishDate: string;
  files: UploadedFileInput[];
};

export type AnalysisJob = {
  id: string;
  reviewCaseId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  currentStep: string;
  startedByUserId?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  artifacts?: AnalysisArtifacts;
};

export type AnalysisResult = {
  reviewCaseId: string;
  status: Extract<ReviewCase["status"], "analysis_queued" | "analysis_complete">;
  issueCount: number;
  analysisHref: string;
  analysisNotice?: string;
  jobId: string;
  extractedDocumentCount?: number;
  evidenceCandidateCount?: number;
};

export type StartAnalysisOptions = {
  artifacts?: AnalysisArtifacts;
};

export type ClaimAnalysisJobResult = AnalysisJob & {
  reviewCase: ReviewCase;
};

export type AuditEventInput = {
  action: string;
  targetType: string;
  targetId?: string;
  beforeValue?: Record<string, unknown>;
  afterValue?: Record<string, unknown>;
};

export type AuditEvent = AuditEventInput & {
  id: string;
  tenantId: string;
  userId: string;
  ipAddress?: string;
  createdAt: string;
};

export type ListAuditEventsOptions = {
  targetType?: string;
  targetId?: string;
};

export type SaveIssueDecisionInput = {
  reviewCaseId: string;
  issueId: string;
  reviewerRiskLevel: RiskLevel;
  finalAction: NonNullable<ReviewIssue["finalAction"]>;
  reviewerComment: string;
};

export type UpdateReviewReviewerInput = {
  reviewCaseId: string;
  reviewer: string;
};

export type UpdateReviewStatusOptions = {
  reviewerComment?: string;
};

export type CreateManualIssueInput = {
  issueType?: string;
  riskLevel: RiskLevel;
  title: string;
  targetText?: string;
  description?: string;
  suggestedAction: ReviewIssue["suggestedAction"];
  suggestedCopy?: string;
};

export type CreateReviewCaseRevisionInput = {
  files: UploadedFileInput[];
};

export type IssueReviewCertificateInput = {
  body: string;
  certificateNumber: string;
  validFrom?: string;
  validUntil?: string;
  remarks?: string;
  // "draft"는 승인 전 워크벤치 임시 저장, "issued"(기본값)는 정식 발급.
  status?: ReviewCertificateStatus;
};

export type FinalReviewStatus = Extract<
  ReviewCase["status"],
  "approved" | "change_requested" | "rejected" | "on_hold"
>;

export type ListIssuesOptions = {
  riskLevel?: RiskLevel;
};

export type ListReviewSummariesOptions = {
  status?: ReviewCase["status"];
  productType?: ProductType;
  affiliateId?: string;
  riskLevel?: RiskLevel;
  page?: number;
  pageSize?: number;
};

export type ReviewSummaryPage = PaginatedResult<ReviewSummary> & {
  reviewCases: ReviewSummary[];
};

export type CreateKnowledgeDocumentInput = Pick<
  KnowledgeDocument,
  | "documentType"
  | "affiliateId"
  | "productType"
  | "title"
  | "version"
  | "effectiveFrom"
  | "storageKey"
> & {
  id?: string;
};

export type CreateKnowledgeDocumentChunkInput = Pick<
  EvidenceChunk,
  | "id"
  | "tenantId"
  | "knowledgeDocumentId"
  | "chunkText"
  | "chunkSummary"
  | "embeddingModel"
  | "embeddingId"
  | "page"
  | "section"
  | "metadata"
> &
  Partial<
    Pick<
      EvidenceChunk,
      | "canonicalSectionKey"
      | "sectionNumber"
      | "changeSetId"
      | "supersedesChunkId"
      | "chunkStatus"
      | "impactTags"
      | "effectiveFrom"
      | "effectiveTo"
      | "sourceReliability"
    >
  >;

export type CreateRegulatorySourceInput = Omit<
  RegulatorySource,
  "id" | "tenantId" | "createdAt" | "updatedAt" | "lastCheckedAt" | "status"
> & {
  id?: string;
  status?: RegulatorySource["status"];
};

export type CreateRegulatorySnapshotInput = Omit<
  RegulatorySnapshot,
  "id" | "tenantId" | "createdAt"
> & {
  id?: string;
};

export type CreateRegulatoryChangeSetInput = Omit<
  RegulatoryChangeSet,
  "id" | "tenantId" | "createdAt" | "createdKnowledgeDocumentId"
> & {
  id?: string;
};

export type ActivateRegulatoryChangeSetInput = {
  changeSetId: string;
  qualityGateStatus?: QualityGateStatus;
  document: CreateKnowledgeDocumentInput &
    Partial<
      Pick<
        KnowledgeDocument,
        | "canonicalKey"
        | "sourceSnapshotId"
        | "changeSetId"
        | "supersedesDocumentId"
        | "autoIngested"
        | "sourcePublishedAt"
        | "interpretationSummary"
      >
    >;
  chunks: Array<
    CreateKnowledgeDocumentChunkInput &
      Partial<
        Pick<
          EvidenceChunk,
          | "canonicalSectionKey"
          | "sectionNumber"
          | "changeSetId"
          | "supersedesChunkId"
          | "chunkStatus"
          | "impactTags"
          | "effectiveFrom"
          | "effectiveTo"
          | "sourceReliability"
        >
      >
  >;
};

export type RegulatoryChangeSetListOptions = {
  sourceId?: string;
  qualityGateStatus?: QualityGateStatus;
};

export type KnowledgeEvidenceSearchInput = {
  query: string;
  productType?: ProductType;
  affiliateId?: string;
  effectiveOn?: string;
  topK?: number;
  minScore?: number;
  /**
   * Retrieval floor for knowledge-corpus candidates. Lower than `minScore` because
   * Korean ad-copy↔regulation cosine tops out ~0.6, so an on-point checklist can sit
   * below the product-doc `minScore` yet still be the correct regulatory basis.
   * Falls back to `minScore` when unset.
   */
  knowledgeMinScore?: number;
  queryEmbedding?: number[];
};

export type CaseHistoryEvidenceSearchInput = KnowledgeEvidenceSearchInput & {
  excludeReviewCaseId?: string;
};

export type CreateChatSessionInput = {
  reviewCaseId: string;
  issueId?: string;
  mode: ChatMode;
};

export type CreateChatMessageInput = {
  sessionId: string;
  content: string;
};

export type CreateChatMessageResult = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
};

export type CreateDraftVersionInput = {
  draft?: string;
  source: DraftVersion["source"];
  sourceMessageIds?: string[];
  evidenceIds?: string[];
};

export type CreateReviewReportInput = {
  reportType: PersistedReviewReport["reportType"];
  tone: "formal" | "soft" | "strict";
  includeChatContext: boolean;
  issueIds: string[];
  draft?: string;
};

export interface ReviewStore {
  listReviewSummaries(
    scope: ReviewStoreScope,
    options?: ListReviewSummariesOptions
  ): Promise<ReviewSummaryPage>;
  getReviewCase(scope: ReviewStoreScope, id: string): Promise<ReviewCase | undefined>;
  isReviewCaseIdAvailable(scope: ReviewStoreScope, id: string): Promise<boolean>;
  createReviewCaseFromSamplePackage(
    scope: ReviewStoreScope,
    input: CreateReviewCaseFromSamplePackageInput
  ): Promise<CreateReviewCaseResult | undefined>;
  createReviewCaseFromUploadedFiles(
    scope: ReviewStoreScope,
    input: CreateReviewCaseFromUploadedFilesInput
  ): Promise<CreateReviewCaseResult>;
  startAnalysis(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    options?: StartAnalysisOptions
  ): Promise<AnalysisResult | undefined>;
  enqueueAnalysis(
    scope: ReviewStoreScope,
    reviewCaseId: string
  ): Promise<AnalysisResult | undefined>;
  claimNextAnalysisJob(
    tenantId: string,
    workerId: string
  ): Promise<ClaimAnalysisJobResult | undefined>;
  completeAnalysisJob(
    scope: ReviewStoreScope,
    jobId: string,
    artifacts: AnalysisArtifacts
  ): Promise<AnalysisResult | undefined>;
  persistAnalysisOutputs(
    scope: ReviewStoreScope,
    input: {
      reviewCaseId: string;
      jobId: string;
      artifacts: AnalysisArtifacts;
    }
  ): Promise<{ issueCount: number; evidenceCount: number } | undefined>;
  failAnalysisJob(
    scope: ReviewStoreScope,
    jobId: string,
    errorMessage: string
  ): Promise<AnalysisJob | undefined>;
  failStaleAnalysisJobs(tenantId: string, olderThanMs: number): Promise<number>;
  getLatestAnalysisJob(
    scope: ReviewStoreScope,
    reviewCaseId: string
  ): Promise<AnalysisJob | undefined>;
  listIssues(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    options?: ListIssuesOptions
  ): Promise<ReviewIssue[] | undefined>;
  getIssue(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    issueId: string
  ): Promise<ReviewIssue | undefined>;
  getIssueEvidence(scope: ReviewStoreScope, issueId: string): Promise<Evidence[] | undefined>;
  saveIssueDecision(
    scope: ReviewStoreScope,
    input: SaveIssueDecisionInput
  ): Promise<ReviewIssue | undefined>;
  createManualIssue(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    input: CreateManualIssueInput
  ): Promise<ReviewIssue | undefined>;
  saveOpinionDraft(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    draft: string
  ): Promise<ReviewCase | undefined>;
  updateReviewReviewer(
    scope: ReviewStoreScope,
    input: UpdateReviewReviewerInput
  ): Promise<ReviewCase | undefined>;
  updateReviewStatus(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    status: FinalReviewStatus,
    options?: UpdateReviewStatusOptions
  ): Promise<ReviewCase | undefined>;
  createReviewCaseRevision(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    input: CreateReviewCaseRevisionInput
  ): Promise<ReviewCase | undefined>;
  listReviewVersions(scope: ReviewStoreScope, reviewCaseId: string): Promise<ReviewVersion[]>;
  /**
   * 케이스의 현재 버전 문서들에 대해 영속화된 OCR 추출 텍스트(EvidenceChunk, source=review_file)를
   * 파일별로 반환한다. 재업로드 변경분석(diff)의 "현재 버전" 비교 소스로 사용한다.
   */
  getReviewDocumentExtractions(
    scope: ReviewStoreScope,
    reviewCaseId: string
  ): Promise<ReviewDocumentExtraction[]>;
  /**
   * 리뷰 케이스 파일들의 OCR 추출 텍스트(EvidenceChunk, source=review_file)만 저장한다.
   * AI 분석 없이 재업로드본의 변경분석(diff)용 텍스트를 확보할 때 사용하며, 이슈/근거는 건드리지 않는다.
   */
  replaceReviewDocumentExtractions(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    documents: ExtractedDocument[]
  ): Promise<void>;
  issueReviewCertificate(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    input: IssueReviewCertificateInput
  ): Promise<ReviewCertificate | undefined>;
  getReviewCertificate(
    scope: ReviewStoreScope,
    reviewCaseId: string
  ): Promise<ReviewCertificate | undefined>;
  deleteReviewCase(scope: ReviewStoreScope, reviewCaseId: string): Promise<ReviewCase | undefined>;
  recordAuditEvent(scope: ReviewStoreScope, input: AuditEventInput): Promise<AuditEvent>;
  listAuditEvents(scope: ReviewStoreScope, options?: ListAuditEventsOptions): Promise<AuditEvent[]>;
  createKnowledgeDocument(
    scope: ReviewStoreScope,
    input: CreateKnowledgeDocumentInput
  ): Promise<KnowledgeDocument>;
  listKnowledgeDocuments(scope: ReviewStoreScope): Promise<KnowledgeDocument[]>;
  approveKnowledgeDocument(
    scope: ReviewStoreScope,
    documentId: string
  ): Promise<KnowledgeDocument | undefined>;
  unapproveKnowledgeDocument(
    scope: ReviewStoreScope,
    documentId: string
  ): Promise<KnowledgeDocument | undefined>;
  deleteKnowledgeDocument(
    scope: ReviewStoreScope,
    documentId: string
  ): Promise<KnowledgeDocument | undefined>;
  replaceKnowledgeDocumentChunks(
    scope: ReviewStoreScope,
    documentId: string,
    chunks: CreateKnowledgeDocumentChunkInput[]
  ): Promise<EvidenceChunk[] | undefined>;
  listKnowledgeDocumentChunks(
    scope: ReviewStoreScope,
    documentId: string
  ): Promise<EvidenceChunk[] | undefined>;
  searchKnowledgeEvidence(
    scope: ReviewStoreScope,
    input: KnowledgeEvidenceSearchInput
  ): Promise<Evidence[]>;
  createRegulatorySource(
    scope: ReviewStoreScope,
    input: CreateRegulatorySourceInput
  ): Promise<RegulatorySource>;
  listRegulatorySources(scope: ReviewStoreScope): Promise<RegulatorySource[]>;
  getRegulatorySource(
    scope: ReviewStoreScope,
    sourceId: string
  ): Promise<RegulatorySource | undefined>;
  createRegulatorySnapshot(
    scope: ReviewStoreScope,
    input: CreateRegulatorySnapshotInput
  ): Promise<RegulatorySnapshot>;
  getLatestRegulatorySnapshot(
    scope: ReviewStoreScope,
    sourceId: string
  ): Promise<RegulatorySnapshot | undefined>;
  listLatestRegulatorySnapshots(
    scope: ReviewStoreScope,
    sourceIds: string[]
  ): Promise<Map<string, RegulatorySnapshot>>;
  createRegulatoryChangeSet(
    scope: ReviewStoreScope,
    input: CreateRegulatoryChangeSetInput
  ): Promise<RegulatoryChangeSet>;
  listRegulatoryChangeSets(
    scope: ReviewStoreScope,
    options?: RegulatoryChangeSetListOptions
  ): Promise<RegulatoryChangeSet[]>;
  getRegulatoryChangeSet(
    scope: ReviewStoreScope,
    changeSetId: string
  ): Promise<RegulatoryChangeSet | undefined>;
  replaceQualityGateResults(
    scope: ReviewStoreScope,
    changeSetId: string,
    results: QualityGateResult[]
  ): Promise<QualityGateResult[] | undefined>;
  listQualityGateResults(
    scope: ReviewStoreScope,
    changeSetId: string
  ): Promise<QualityGateResult[] | undefined>;
  activateRegulatoryChangeSet(
    scope: ReviewStoreScope,
    input: ActivateRegulatoryChangeSetInput
  ): Promise<
    | {
        changeSet: RegulatoryChangeSet;
        document: KnowledgeDocument;
        chunks: EvidenceChunk[];
      }
    | undefined
  >;
  searchCaseHistoryEvidence(
    scope: ReviewStoreScope,
    input: CaseHistoryEvidenceSearchInput
  ): Promise<Evidence[]>;
  createChatSession(
    scope: ReviewStoreScope,
    input: CreateChatSessionInput
  ): Promise<ChatSession | undefined>;
  createChatMessage(
    scope: ReviewStoreScope,
    input: CreateChatMessageInput
  ): Promise<CreateChatMessageResult | undefined>;
  markChatMessageForDraft(
    scope: ReviewStoreScope,
    messageId: string,
    markedForDraft: boolean
  ): Promise<ChatMessage | undefined>;
  createDraftVersion(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    input: CreateDraftVersionInput
  ): Promise<DraftVersion | undefined>;
  createReviewReport(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    input: CreateReviewReportInput
  ): Promise<PersistedReviewReport | undefined>;
  listCaseLibrary(
    scope: ReviewStoreScope,
    options?: ListReviewSummariesOptions
  ): Promise<ReviewSummaryPage>;
}
