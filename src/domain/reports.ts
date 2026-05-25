import { statusLabels } from "./reviews";
import type { ReviewCase, ReviewIssue } from "./types";

export type ReportType = NonNullable<ReviewIssue["finalAction"]>;
export type ReportTone = "formal" | "soft" | "strict";

export type GenerateReviewReportInput = {
  review: ReviewCase;
  reportType: ReportType;
  tone: ReportTone;
  includeChatContext: boolean;
  issueIds: string[];
  draft?: string;
};

export type ReviewReport = {
  reportId: string;
  contentMarkdown: string;
  evidenceIds: string[];
  version: number;
};

const actionLabels: Record<ReportType, string> = {
  approve: "승인",
  change_request: "수정 요청",
  reject: "반려",
  hold: "보류"
};

const toneLabels: Record<ReportTone, string> = {
  formal: "공식",
  soft: "완화",
  strict: "엄격"
};

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function formatIssue(issue: ReviewIssue, index: number): string {
  const evidenceList =
    issue.evidence.length > 0
      ? issue.evidence
          .map(
            (evidence) =>
              `- ${evidence.title}: ${evidence.quoteSummary} (p.${evidence.page ?? "-"}, ${Math.round(
                evidence.relevanceScore * 100
              )}%)`
          )
          .join("\n")
      : "- 연결된 근거 없음";

  return [
    `### ${index + 1}. ${issue.title}`,
    `- 대상 문구: ${issue.targetText}`,
    `- 위험 수준: ${issue.riskLevel}`,
    `- 권고 조치: ${actionLabels[issue.suggestedAction]}`,
    issue.reviewerComment ? `- 검토자 의견: ${issue.reviewerComment}` : null,
    "",
    issue.description,
    "",
    "수정 제안:",
    issue.suggestedCopy,
    "",
    "근거:",
    evidenceList
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function generateReviewReport({
  review,
  reportType,
  tone,
  includeChatContext,
  issueIds,
  draft
}: GenerateReviewReportInput): ReviewReport {
  const selectedIssueIds = new Set(issueIds);
  const selectedIssues = review.issues.filter((issue) => selectedIssueIds.has(issue.id));
  const evidenceIds = unique(selectedIssues.flatMap((issue) => issue.evidence.map((e) => e.id)));
  const reportDraft = draft?.trim() ? draft : (review.currentDraft ?? review.expectedDraft);
  const issueMarkdown =
    selectedIssues.length > 0
      ? selectedIssues.map(formatIssue).join("\n\n")
      : "선택된 이슈가 없습니다.";

  return {
    reportId: `report-${review.id}-v1`,
    version: 1,
    evidenceIds,
    contentMarkdown: [
      `# ${review.title} 리포트`,
      "",
      "## 심의 정보",
      `- 심의 ID: ${review.id}`,
      `- 제휴사: ${review.affiliate}`,
      `- 상품 유형: ${review.productType}`,
      `- 채널: ${review.channelType.join(", ")}`,
      `- 게시 예정일: ${review.plannedPublishDate}`,
      `- 현재 상태: ${statusLabels[review.status]}`,
      `- 리포트 유형: ${actionLabels[reportType]}`,
      `- 문체: ${toneLabels[tone]}`,
      `- 채팅 컨텍스트 포함: ${includeChatContext ? "예" : "아니오"}`,
      "",
      "## 최종 의견 초안",
      reportDraft,
      "",
      "## 검토 이슈",
      issueMarkdown,
      "",
      "## 자료 패키지",
      ...review.files.map(
        (file) =>
          `- ${file.name}: ${file.fileType}, ${file.parseStatus}, 신뢰도 ${Math.round(
            file.classificationConfidence * 100
          )}%`
      ),
      "",
      "## 누락 자료",
      review.missingMaterials.length > 0 ? review.missingMaterials.join(", ") : "없음"
    ].join("\n")
  };
}
