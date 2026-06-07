import type { Evidence, ReviewCase, ReviewIssue } from "./types";

export type ReviewChatResponse = {
  id: string;
  question: string;
  answerType: "evidence_based" | "insufficient_evidence";
  content: string;
  evidence: Evidence[];
  requiredMaterials: string[];
};

const riskLabel: Record<ReviewIssue["riskLevel"], string> = {
  info: "참고",
  caution: "주의",
  high: "위험"
};

const riskRank: Record<ReviewIssue["riskLevel"], number> = {
  info: 1,
  caution: 2,
  high: 3
};

function compactLines(lines: Array<string | undefined>): string[] {
  return lines.map((line) => line?.trim() ?? "").filter((line) => line.length > 0);
}

function evidenceSourceLabel(evidence: Evidence): string {
  return compactLines([evidence.title, evidence.section]).join(" ");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function answerReviewQuestion({
  review,
  issue,
  question
}: {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
}): ReviewChatResponse {
  const normalizedQuestion = question.replace(/\s+/g, " ").trim();
  const asksForTerms = normalizedQuestion.includes("약관");
  const termsMissing = !review.files.some((file) => file.fileType === "terms");

  if (asksForTerms && termsMissing) {
    return {
      id: `msg-${issue.id}-fallback`,
      question,
      answerType: "insufficient_evidence",
      content:
        "추가 확인 필요: 현재 업로드된 자료와 승인된 지식베이스에서는 약관에만 있는 조건을 단정할 근거가 부족합니다.",
      evidence: [],
      requiredMaterials: ["약관"]
    };
  }

  return {
    id: `msg-${issue.id}-evidence`,
    question,
    answerType: "evidence_based",
    content:
      "현재 근거상 조건부 혜택임을 본문 또는 인접 고지에서 명확히 표시하는 수정이 필요합니다.",
    evidence: issue.evidence,
    requiredMaterials: []
  };
}

export function generateDraftWithChatContext(
  review: ReviewCase,
  chatResponses: ReviewChatResponse[]
): string {
  const baseDraft = generateIssueBasedOpinionDraft(review);
  const evidenceTitles = Array.from(
    new Set(
      chatResponses.flatMap((response) => response.evidence.map((evidence) => evidence.title))
    )
  );

  if (chatResponses.length === 0 || evidenceTitles.length === 0) {
    return baseDraft;
  }

  return `${baseDraft}\n\n채팅 반영: 선택 이슈 질의에서 확인한 근거(${evidenceTitles.join(
    ", "
  )})를 기준으로 우대 조건을 본문 또는 인접 고지에 명확히 표시하도록 요청합니다.`;
}

export function generateIssueBasedOpinionDraft(review: ReviewCase): string {
  if (review.issues.length === 0) {
    return review.expectedDraft;
  }

  const issues = [...review.issues].sort(
    (left, right) => riskRank[right.riskLevel] - riskRank[left.riskLevel]
  );
  const lines = [
    "수정 요청 의견 초안",
    "",
    `심의 대상: ${review.affiliate} ${review.title}`,
    `상품군: ${review.productType}`,
    `게시 예정일: ${review.plannedPublishDate}`,
    "",
    "주요 검토 이슈"
  ];

  issues.forEach((issue, index) => {
    const evidenceSources = unique(issue.evidence.map(evidenceSourceLabel));
    lines.push(
      "",
      `${index + 1}. ${issue.title}`,
      `- 위험 수준: ${riskLabel[issue.riskLevel]}`,
      `- 대상 문구: ${issue.targetText}`,
      `- 판단 근거: ${issue.description}`,
      `- 수정 의견: ${issue.suggestedCopy}`
    );

    if (evidenceSources.length > 0) {
      lines.push(`- 참고 출처: ${evidenceSources.join(", ")}`);
    }
  });

  lines.push("", "종합 의견:", "위 이슈가 반영된 수정본 제출 후 재검토가 필요합니다.");

  return lines.join("\n");
}

export function shouldReplaceStaleOpinionDraft(draft?: string): boolean {
  const text = draft?.trim();

  if (!text) {
    return true;
  }

  return /OCR\/RAG 분석 전|실제 업로드 자료 분석 대기|근거 부족 상태|파일 분류와 누락 자료|구체적 근거 확인이 어렵|자료만으로는 광고 표시 내용/.test(
    text
  );
}
