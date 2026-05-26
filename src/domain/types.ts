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

export type ProductType = "deposit" | "loan" | "card" | "capital" | "insurance" | "investment";

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

export type KnowledgeDocument = {
  id: string;
  tenantId: string;
  affiliateId?: string;
  documentType: KnowledgeDocumentType;
  productType?: ProductType;
  title: string;
  version: string;
  effectiveFrom: string;
  effectiveTo?: string;
  approvalStatus: KnowledgeApprovalStatus;
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
  chunkText: string;
  chunkSummary?: string;
  embeddingModel: string;
  embeddingId: string;
  page?: number;
  section?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AgentRunStatus = "queued" | "running" | "completed" | "failed";
export type AgentType =
  | "main"
  | "creative"
  | "product_terms"
  | "regulation"
  | "internal_policy"
  | "case_search";

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
