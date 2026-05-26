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
  RoleId,
  ReviewCase,
  ReviewFile,
  ReviewIssue,
  ReviewSummary,
  RiskLevel
} from "@/domain/types";
import type { AnalysisArtifacts } from "@/server/analysis/review-analysis-pipeline";

export type ReviewStoreScope = {
  tenantId: string;
  actorUserId: string;
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
>;

export type KnowledgeEvidenceSearchInput = {
  query: string;
  productType?: ProductType;
  affiliateId?: string;
  topK?: number;
  minScore?: number;
  queryEmbedding?: number[];
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
  saveOpinionDraft(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    draft: string
  ): Promise<ReviewCase | undefined>;
  updateReviewStatus(
    scope: ReviewStoreScope,
    reviewCaseId: string,
    status: FinalReviewStatus
  ): Promise<ReviewCase | undefined>;
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
  replaceKnowledgeDocumentChunks(
    scope: ReviewStoreScope,
    documentId: string,
    chunks: CreateKnowledgeDocumentChunkInput[]
  ): Promise<EvidenceChunk[] | undefined>;
  searchKnowledgeEvidence(
    scope: ReviewStoreScope,
    input: KnowledgeEvidenceSearchInput
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
