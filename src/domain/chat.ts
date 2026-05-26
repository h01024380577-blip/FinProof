import type { Evidence, ReviewCase, ReviewIssue } from "./types";

export type ReviewChatResponse = {
  id: string;
  question: string;
  answerType: "evidence_based" | "insufficient_evidence";
  content: string;
  evidence: Evidence[];
  requiredMaterials: string[];
};

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
  const evidenceTitles = Array.from(
    new Set(
      chatResponses.flatMap((response) => response.evidence.map((evidence) => evidence.title))
    )
  );

  if (chatResponses.length === 0 || evidenceTitles.length === 0) {
    return review.expectedDraft;
  }

  return `${review.expectedDraft}\n\n채팅 반영: 선택 이슈 질의에서 확인한 근거(${evidenceTitles.join(
    ", "
  )})를 기준으로 우대 조건을 본문 또는 인접 고지에 명확히 표시하도록 요청합니다.`;
}
