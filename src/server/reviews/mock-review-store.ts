import { getRequiredMaterialRows } from "@/domain/intake";
import { reviewCases } from "@/domain/reviews";
import { classifyUploadFile } from "@/domain/upload-policy";
import type {
  ProductType,
  ReviewCase,
  ReviewFile,
  ReviewIssue,
  ReviewSummary
} from "@/domain/types";
import type {
  AnalysisResult,
  CreateReviewCaseFromUploadedFilesInput,
  CreateReviewCaseFromSamplePackageInput,
  CreateReviewCaseResult,
  ListIssuesOptions,
  ReviewStore,
  SaveIssueDecisionInput
} from "./review-store";

const uploadAnalysisNotice = "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다.";

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

function confidenceFor(fileType: ReviewFile["fileType"]): number {
  if (fileType === "misc") {
    return 0.62;
  }

  if (fileType === "package_archive") {
    return 0.66;
  }

  if (fileType === "promotional_creative" || fileType === "rate_table") {
    return 0.78;
  }

  return 0.74;
}

function missingMaterialKeys(review: Pick<ReviewCase, "productType" | "files">): string[] {
  return getRequiredMaterialRows(review)
    .filter((row) => row.status === "missing")
    .map((row) => (row.fileType === "checklist" ? "internal_checklist" : row.fileType));
}

function defaultExpectedDraft(productType: ProductType): string {
  return `${productType} 상품 실제 업로드 자료는 접수되었습니다. 현재 Demo MVP에서는 OCR/RAG 분석 전이므로 파일 분류와 누락 자료 확인 결과를 기준으로 추가 확인이 필요합니다.`;
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
  let uploadSequence = 1;

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

    async createReviewCaseFromUploadedFiles(
      input: CreateReviewCaseFromUploadedFilesInput
    ): Promise<CreateReviewCaseResult> {
      const id = `rc-upload-${String(uploadSequence).padStart(3, "0")}`;
      uploadSequence += 1;

      const files = input.files.map<ReviewFile>((file, index) => {
        const contentType = file.type || inferContentType(file.name);
        const fileType = classifyUploadFile({ ...file, type: contentType });

        return {
          id: `file-upload-${String(index + 1).padStart(3, "0")}`,
          name: file.name,
          fileType,
          classificationConfidence: confidenceFor(fileType),
          parseStatus: "pending",
          storageProvider: "local",
          storageKey: `local/${id}/${file.name}`,
          contentType,
          sizeBytes: file.size
        };
      });

      const reviewCase: ReviewCase = {
        id,
        title: input.title,
        affiliate: input.affiliate,
        productType: input.productType,
        channelType: input.channelType,
        plannedPublishDate: input.plannedPublishDate,
        status: "submitted",
        highestRiskLevel: "info",
        requester: "업로드 요청자",
        reviewer: "준법심의자 박민준",
        promotionalCopy: "실제 업로드 자료 분석 대기",
        disclosure: uploadAnalysisNotice,
        productDescription: "실제 업로드 파일의 본문 추출은 아직 적용되지 않았습니다.",
        missingMaterials: [],
        files,
        issues: [],
        expectedDraft: defaultExpectedDraft(input.productType),
        analysisNotice: uploadAnalysisNotice
      };

      reviewCase.missingMaterials = missingMaterialKeys(reviewCase);
      cases.set(id, clone(reviewCase));

      return {
        reviewCase: clone(reviewCase),
        files: clone(files),
        missingMaterials: [...reviewCase.missingMaterials],
        analysisStartHref: `/api/v1/review-cases/${id}/analysis/start`
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
        analysisHref: `/reviews/${reviewCaseId}`,
        analysisNotice: updatedReview.analysisNotice
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
