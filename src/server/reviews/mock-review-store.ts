import { reviewCases } from "@/domain/reviews";
import type { ReviewCase, ReviewFile, ReviewIssue, ReviewSummary } from "@/domain/types";
import type {
  AnalysisResult,
  CreateReviewCaseFromSamplePackageInput,
  CreateReviewCaseResult,
  ListIssuesOptions,
  ReviewStore,
  SaveIssueDecisionInput
} from "./review-store";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function inferContentType(fileName: string): string {
  if (fileName.endsWith(".png")) {
    return "image/png";
  }

  if (fileName.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (fileName.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  return "application/octet-stream";
}

function withStorageMetadata(review: ReviewCase): ReviewCase {
  return {
    ...review,
    files: review.files.map<ReviewFile>((file) => ({
      ...file,
      storageProvider: "sample",
      storageKey: `sample/${review.id}/${file.name}`,
      contentType: inferContentType(file.name),
      sizeBytes: file.name.length * 1024
    }))
  };
}

function toSummary(review: ReviewCase): ReviewSummary {
  return {
    id: review.id,
    title: review.title,
    affiliate: review.affiliate,
    productType: review.productType,
    plannedPublishDate: review.plannedPublishDate,
    status: review.status,
    highestRiskLevel: review.highestRiskLevel,
    requester: review.requester,
    reviewer: review.reviewer
  };
}

export function createMockReviewStore(seedCases: ReviewCase[] = reviewCases): ReviewStore {
  const samples = new Map(
    seedCases.map((review) => [review.id, withStorageMetadata(clone(review))])
  );
  const cases = new Map(Array.from(samples, ([id, review]) => [id, clone(review)]));

  return {
    async listReviewSummaries() {
      return Array.from(cases.values()).map(toSummary);
    },

    async getReviewCase(id) {
      const review = cases.get(id);

      return review ? clone(review) : undefined;
    },

    async createReviewCaseFromSamplePackage({
      samplePackageId
    }: CreateReviewCaseFromSamplePackageInput): Promise<CreateReviewCaseResult | undefined> {
      const sample = samples.get(samplePackageId);

      if (!sample) {
        return undefined;
      }

      const reviewCase: ReviewCase = {
        ...clone(sample),
        status: "submitted"
      };

      cases.set(reviewCase.id, clone(reviewCase));

      return {
        reviewCase: clone(reviewCase),
        files: clone(reviewCase.files),
        missingMaterials: [...reviewCase.missingMaterials],
        analysisStartHref: `/api/v1/review-cases/${reviewCase.id}/analysis/start`
      };
    },

    async startAnalysis(reviewCaseId): Promise<AnalysisResult | undefined> {
      const review = cases.get(reviewCaseId);

      if (!review) {
        return undefined;
      }

      const updatedReview: ReviewCase = {
        ...review,
        status: "analysis_complete"
      };

      cases.set(reviewCaseId, updatedReview);

      return {
        reviewCaseId,
        status: "analysis_complete",
        issueCount: updatedReview.issues.length,
        analysisHref: `/reviews/${reviewCaseId}`
      };
    },

    async listIssues(reviewCaseId, options: ListIssuesOptions = {}) {
      const review = cases.get(reviewCaseId);

      if (!review) {
        return undefined;
      }

      const issues = options.riskLevel
        ? review.issues.filter((issue) => issue.riskLevel === options.riskLevel)
        : review.issues;

      return clone(issues);
    },

    async getIssue(reviewCaseId, issueId) {
      const review = cases.get(reviewCaseId);
      const issue = review?.issues.find((candidate) => candidate.id === issueId);

      return issue ? clone(issue) : undefined;
    },

    async getIssueEvidence(issueId) {
      const issue = Array.from(cases.values())
        .flatMap((review) => review.issues)
        .find((candidate) => candidate.id === issueId);

      return issue ? clone(issue.evidence) : undefined;
    },

    async saveIssueDecision({
      reviewCaseId,
      issueId,
      reviewerRiskLevel,
      finalAction,
      reviewerComment
    }: SaveIssueDecisionInput): Promise<ReviewIssue | undefined> {
      const review = cases.get(reviewCaseId);

      if (!review) {
        return undefined;
      }

      let updatedIssue: ReviewIssue | undefined;
      const updatedIssues = review.issues.map((issue) => {
        if (issue.id !== issueId) {
          return issue;
        }

        updatedIssue = {
          ...issue,
          reviewerRiskLevel,
          finalAction,
          reviewerComment,
          status: "reviewed"
        };

        return updatedIssue;
      });

      if (!updatedIssue) {
        return undefined;
      }

      cases.set(reviewCaseId, {
        ...review,
        issues: updatedIssues
      });

      return clone(updatedIssue);
    },

    async saveOpinionDraft(reviewCaseId, draft) {
      const review = cases.get(reviewCaseId);

      if (!review) {
        return undefined;
      }

      const updatedReview = {
        ...review,
        currentDraft: draft
      };

      cases.set(reviewCaseId, updatedReview);

      return clone(updatedReview);
    }
  };
}
