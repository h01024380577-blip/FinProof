import type { Evidence, ReviewCase, ReviewIssue, ReviewSummary, RiskLevel } from "@/domain/types";

export type CreateReviewCaseFromSamplePackageInput = {
  samplePackageId: string;
};

export type CreateReviewCaseResult = {
  reviewCase: ReviewCase;
  files: ReviewCase["files"];
  missingMaterials: string[];
  analysisStartHref: string;
};

export type AnalysisResult = {
  reviewCaseId: string;
  status: "analysis_complete";
  issueCount: number;
  analysisHref: string;
};

export type SaveIssueDecisionInput = {
  reviewCaseId: string;
  issueId: string;
  reviewerRiskLevel: RiskLevel;
  finalAction: NonNullable<ReviewIssue["finalAction"]>;
  reviewerComment: string;
};

export type ListIssuesOptions = {
  riskLevel?: RiskLevel;
};

export interface ReviewStore {
  listReviewSummaries(): Promise<ReviewSummary[]>;
  getReviewCase(id: string): Promise<ReviewCase | undefined>;
  createReviewCaseFromSamplePackage(
    input: CreateReviewCaseFromSamplePackageInput
  ): Promise<CreateReviewCaseResult | undefined>;
  startAnalysis(reviewCaseId: string): Promise<AnalysisResult | undefined>;
  listIssues(reviewCaseId: string, options?: ListIssuesOptions): Promise<ReviewIssue[] | undefined>;
  getIssue(reviewCaseId: string, issueId: string): Promise<ReviewIssue | undefined>;
  getIssueEvidence(issueId: string): Promise<Evidence[] | undefined>;
  saveIssueDecision(input: SaveIssueDecisionInput): Promise<ReviewIssue | undefined>;
  saveOpinionDraft(reviewCaseId: string, draft: string): Promise<ReviewCase | undefined>;
}
