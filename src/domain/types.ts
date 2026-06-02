export type RoleId = "requester" | "reviewer" | "compliance_admin";

export type RiskLevel = "info" | "caution" | "high" | "reject_recommended";

export type ReviewStatus =
  | "draft"
  | "submitted"
  | "parsing"
  | "analysis_waiting"
  | "analysis_queued"
  | "analysis_in_progress"
  | "analysis_complete"
  | "under_review"
  | "change_requested"
  | "rejected"
  | "approved"
  | "on_hold"
  | "archived";

export type ReviewAction = "start_analysis" | "open_workbench" | "view_audit";

export type ProductType =
  | "deposit"
  | "loan"
  | "card"
  | "capital"
  | "insurance"
  | "investment"
  | "image_test";

export type ReviewFile = {
  id: string;
  name: string;
  fileType:
    | "promotional_creative"
    | "copy_draft"
    | "product_description"
    | "terms"
    | "rate_table"
    | "checklist"
    | "url_list"
    | "package_archive"
    | "misc";
  classificationConfidence: number;
  parseStatus: "pending" | "parsed" | "failed";
  storageProvider?: "sample" | "local" | "s3";
  storageKey?: string;
  contentType?: string;
  sizeBytes?: number;
};

export type Evidence = {
  id: string;
  sourceType: "law" | "internal_policy" | "product_doc" | "case_history";
  documentId?: string;
  chunkId?: string;
  version?: string;
  effectiveFrom?: string;
  title: string;
  page?: number;
  section?: string;
  quoteSummary: string;
  relevanceScore: number;
};

export type MultilingualIssueContext = {
  segmentId: string;
  language: "en" | "ja" | "zh";
  originalText: string;
  literalTranslation: string;
  complianceMeaning: string;
  riskCategory: "expression_risk" | "compliance_risk" | "both";
  riskSignals: string[];
  koreanComplianceCategory: string;
  koreanComplianceReason: string;
  evidenceQuery: string;
  suggestedCopyOriginalLanguage: string;
  suggestedCopyKoreanMeaning: string;
};

export type ReviewIssue = {
  id: string;
  issueType: string;
  riskLevel: RiskLevel;
  reviewerRiskLevel?: RiskLevel;
  title: string;
  targetText: string;
  targetBbox: [number, number, number, number];
  targetFileId?: string;
  targetPage?: number;
  confidence?: number;
  agentFindingId?: string;
  sourceAgents: string[];
  suggestedAction: "approve" | "change_request" | "reject" | "hold";
  finalAction?: "approve" | "change_request" | "reject" | "hold";
  reviewerComment?: string;
  status: "open" | "reviewed" | "resolved" | "dismissed";
  description: string;
  suggestedCopy: string;
  multilingualContext?: MultilingualIssueContext;
  evidence: Evidence[];
};

export type ReviewCase = {
  id: string;
  title: string;
  affiliate: string;
  productType: ProductType;
  channelType: string[];
  plannedPublishDate: string;
  status: ReviewStatus;
  highestRiskLevel: RiskLevel;
  requester: string;
  reviewer: string;
  promotionalCopy: string;
  disclosure: string;
  productDescription: string;
  missingMaterials: string[];
  files: ReviewFile[];
  issues: ReviewIssue[];
  expectedDraft: string;
  currentDraft?: string;
  currentDraftVersion?: number;
  analysisNotice?: string;
};

export type ReviewSummary = Pick<
  ReviewCase,
  | "id"
  | "title"
  | "affiliate"
  | "productType"
  | "plannedPublishDate"
  | "status"
  | "highestRiskLevel"
  | "requester"
  | "reviewer"
> & {
  availableActions?: ReviewAction[];
};

export type PaginatedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type KnowledgeDocumentType = "law" | "internal_policy" | "checklist" | "guide";
export type KnowledgeApprovalStatus = "draft" | "approved" | "inactive";
export type KnowledgeLifecycleStatus = "active" | "superseded" | "inactive";
export type EvidenceChunkStatus = "active" | "superseded" | "inactive";

export type RegulatorySourceType =
  | "regulator"
  | "law_portal"
  | "association"
  | "internal_policy_repo"
  | "case_knowledge";

export type RegulatorySourceStatus = "active" | "paused" | "failing";

export type RegulatoryChangeType =
  | "created"
  | "amended"
  | "deleted"
  | "wording_changed"
  | "effective_date_changed"
  | "scope_changed"
  | "interpretation_changed";

export type RegulatoryRiskImpactLevel = "info" | "caution" | "high" | "critical";

export type QualityGateType =
  | "citation_coverage"
  | "schema_validation"
  | "contradiction_check"
  | "retrieval_regression"
  | "effective_date"
  | "rollback_ready";

export type QualityGateStatus = "passed" | "failed" | "flagged";

export type KnowledgeDocument = {
  id: string;
  tenantId: string;
  affiliateId?: string;
  canonicalKey?: string;
  sourceSnapshotId?: string;
  changeSetId?: string;
  supersedesDocumentId?: string;
  documentType: KnowledgeDocumentType;
  productType?: ProductType;
  title: string;
  version: string;
  effectiveFrom: string;
  effectiveTo?: string;
  lifecycleStatus?: KnowledgeLifecycleStatus;
  approvalStatus: KnowledgeApprovalStatus;
  autoIngested?: boolean;
  sourcePublishedAt?: string;
  interpretationSummary?: string;
  storageKey: string;
  createdBy: string;
  approvedBy?: string;
  createdAt: string;
  approvedAt?: string;
};

export type EvidenceChunk = {
  id: string;
  tenantId: string;
  knowledgeDocumentId?: string;
  reviewFileId?: string;
  canonicalSectionKey?: string;
  sectionNumber?: string;
  changeSetId?: string;
  supersedesChunkId?: string;
  chunkText: string;
  chunkSummary?: string;
  chunkStatus?: EvidenceChunkStatus;
  impactTags?: string[];
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceReliability?: number;
  embeddingModel: string;
  embeddingId: string;
  page?: number;
  section?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type RegulatorySource = {
  id: string;
  tenantId: string;
  sourceType: RegulatorySourceType;
  name: string;
  url?: string;
  repositoryPath?: string;
  pollingSchedule: string;
  trustLevel: "official" | "industry" | "internal" | "reference";
  lastCheckedAt?: string;
  status: RegulatorySourceStatus;
  createdAt: string;
  updatedAt: string;
};

export type RegulatorySnapshot = {
  id: string;
  sourceId: string;
  tenantId: string;
  sourceUrl?: string;
  title: string;
  publishedAt?: string;
  effectiveFrom?: string;
  contentHash: string;
  rawStorageKey: string;
  normalizedStorageKey: string;
  detectedDocumentType: KnowledgeDocumentType;
  fetchStatus: "fetched" | "unchanged" | "failed";
  normalizationConfidence: number;
  createdAt: string;
};

export type RegulatoryChangedSection = {
  sectionId: string;
  sectionNumber?: string;
  title: string;
  previousText?: string;
  newText?: string;
  diffSummary: string;
  citation: {
    snapshotId: string;
    sectionId: string;
  };
};

export type RegulatoryChangeSet = {
  id: string;
  tenantId: string;
  sourceId: string;
  previousSnapshotId?: string;
  newSnapshotId: string;
  changeType: RegulatoryChangeType;
  changeSummary: string;
  changedSections: RegulatoryChangedSection[];
  effectiveFrom?: string;
  riskImpactLevel: RegulatoryRiskImpactLevel;
  interpretationSummary: string;
  mappedProductTypes: ProductType[];
  mappedChannels: string[];
  mappedReviewCategories: string[];
  qualityGateStatus: QualityGateStatus;
  confidence: number;
  createdKnowledgeDocumentId?: string;
  createdAt: string;
};

export type QualityGateResult = {
  id: string;
  changeSetId: string;
  gateType: QualityGateType;
  status: QualityGateStatus;
  summary: string;
  evidence: Record<string, unknown>;
  createdAt: string;
};

export type AgentRunStatus = "queued" | "running" | "completed" | "failed";
export type AgentType =
  | "main"
  | "creative"
  | "product_terms"
  | "regulation"
  | "internal_policy"
  | "case_search"
  | "english_translator_risk"
  | "japanese_translator_risk"
  | "chinese_translator_risk"
  | "korean_compliance_mapping";

export type AgentRun = {
  id: string;
  reviewCaseId: string;
  analysisJobId?: string;
  agentType: AgentType;
  status: AgentRunStatus;
  model: string;
  modelTier: string;
  escalationReason?: string;
  inputSnapshot: Record<string, unknown>;
  outputSnapshot?: Record<string, unknown>;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
};

export type ChatMode = "issue" | "case" | "similar_case" | "draft";
export type ChatRole = "user" | "assistant" | "system";

export type ChatSession = {
  id: string;
  reviewCaseId: string;
  issueId?: string;
  userId: string;
  mode: ChatMode;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  chatSessionId: string;
  role: ChatRole;
  content: string;
  evidenceIds: string[];
  markedForDraft: boolean;
  createdAt: string;
};

export type DraftVersion = {
  id: string;
  reviewCaseId: string;
  version: number;
  draft: string;
  source: "generated" | "manual" | "fallback";
  sourceMessageIds: string[];
  evidenceIds: string[];
  createdBy: string;
  createdAt: string;
};

export type PersistedReviewReport = {
  id: string;
  reviewCaseId: string;
  reportType: "approve" | "change_request" | "reject" | "hold";
  contentMarkdown: string;
  evidenceIds: string[];
  version: number;
  storageKey?: string;
  createdBy: string;
  createdAt: string;
};
