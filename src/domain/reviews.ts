import sampleReviewCases from "@/data/sample-review-cases.json";
import type {
  ProductType,
  ReviewCase,
  ReviewIssue,
  ReviewSummary,
  RiskLevel,
  RoleId
} from "./types";

export const reviewCases = sampleReviewCases as ReviewCase[];

export const roles: Array<{ id: RoleId; label: string; description: string }> = [
  {
    id: "reviewer",
    label: "심의자",
    description: "AI 분석 결과 검토"
  },
  {
    id: "requester",
    label: "요청자",
    description: "심의 요청 생성"
  }
];

export const riskLabels: Record<RiskLevel, string> = {
  info: "참고",
  caution: "주의",
  high: "위험",
  reject_recommended: "반려 권고"
};

export const productLabels: Record<ProductType, string> = {
  deposit: "예금/적금",
  loan: "대출",
  card: "카드",
  capital: "캐피탈",
  insurance: "보험",
  investment: "투자상품"
};

export const statusLabels: Record<ReviewCase["status"], string> = {
  draft: "초안",
  submitted: "제출됨",
  parsing: "자료 분석",
  analysis_waiting: "분석 대기",
  analysis_queued: "분석 대기 중",
  analysis_in_progress: "AI 분석 중",
  analysis_complete: "AI 분석 완료",
  under_review: "심의 중",
  change_requested: "수정 요청",
  rejected: "반려",
  approved: "승인",
  on_hold: "보류",
  archived: "보관"
};

export function getReviewSummaries(): ReviewSummary[] {
  return reviewCases.map(
    ({
      id,
      title,
      affiliate,
      productType,
      plannedPublishDate,
      status,
      highestRiskLevel,
      requester,
      reviewer
    }) => ({
      id,
      title,
      affiliate,
      productType,
      plannedPublishDate,
      status,
      highestRiskLevel,
      requester,
      reviewer
    })
  );
}

export function getReviewCaseById(id: string): ReviewCase | undefined {
  return reviewCases.find((review) => review.id === id);
}

export function getRiskFilteredIssues(id: string, riskLevel: RiskLevel): ReviewIssue[] {
  return getReviewCaseById(id)?.issues.filter((issue) => issue.riskLevel === riskLevel) ?? [];
}

export function getIssueCounts(review: ReviewCase): Record<RiskLevel, number> {
  return review.issues.reduce<Record<RiskLevel, number>>(
    (counts, issue) => ({
      ...counts,
      [issue.riskLevel]: counts[issue.riskLevel] + 1
    }),
    {
      info: 0,
      caution: 0,
      high: 0,
      reject_recommended: 0
    }
  );
}
