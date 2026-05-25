export type RoleId = "requester" | "reviewer" | "compliance_admin";

export type RiskLevel = "info" | "caution" | "high" | "reject_recommended";

export type ReviewStatus =
  | "draft"
  | "submitted"
  | "parsing"
  | "analysis_in_progress"
  | "analysis_complete"
  | "under_review"
  | "change_requested"
  | "rejected"
  | "approved"
  | "on_hold"
  | "archived";

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
>;
