import {
  answerReviewQuestion,
  chatProgressLabel,
  detectReviewDraftLanguage,
  generateDraftWithChatContext,
  generateIssueBasedOpinionDraft
} from "./chat";
import { getReviewCaseById } from "./reviews";
import type { MultilingualIssueContext, ReviewCase } from "./types";

const vietnameseContext: MultilingualIssueContext = {
  segmentId: "seg-vi-001",
  language: "vi",
  originalText: "Vay tiền nhanh, duyệt trong 5 phút, ai cũng được vay",
  literalTranslation: "빠른 대출, 5분 내 승인, 누구나 대출 가능",
  complianceMeaning: "무조건 승인을 암시하는 단정적 표현",
  riskCategory: "both",
  riskSignals: ["guaranteed_approval", "absolute_expression"],
  koreanComplianceCategory: "단정적 표현",
  koreanComplianceReason: "심사 절차를 생략한 무조건 승인 오인 소지",
  evidenceQuery: "대출 광고 단정적 표현 금지",
  suggestedCopyOriginalLanguage: "Vay tiền nhanh (tùy theo điều kiện xét duyệt)",
  suggestedCopyKoreanMeaning: "빠른 대출 (심사 조건에 따라 다름)"
};

describe("review chat guardrails", () => {
  const review = getReviewCaseById("rc-demo-deposit-001")!;
  const issue = review.issues[0];

  it("answers selected issue questions with evidence references", () => {
    const response = answerReviewQuestion({
      review,
      issue,
      question: "우대금리 조건을 어느 수준까지 표시해야 하나요?"
    });

    expect(response.answerType).toBe("evidence_based");
    expect(response.evidence.map((evidence) => evidence.title)).toEqual(
      expect.arrayContaining(["정기적금 상품설명서", "금리 광고 내부 체크리스트"])
    );
  });

  it("uses insufficient evidence fallback for terms-only questions when terms are missing", () => {
    const response = answerReviewQuestion({
      review,
      issue,
      question: "약관에만 있는 중도해지 조건도 단정해도 되나요?"
    });

    expect(response.answerType).toBe("insufficient_evidence");
    expect(response.content).toContain("추가 확인 필요");
    expect(response.requiredMaterials).toEqual(["약관"]);
  });

  it("generates a draft that includes marked chat context without inventing new evidence", () => {
    const response = answerReviewQuestion({
      review,
      issue,
      question: "우대금리 조건을 어느 수준까지 표시해야 하나요?"
    });

    const draft = generateDraftWithChatContext(review, [response]);

    expect(draft).toContain(issue.title);
    expect(draft).toContain(issue.suggestedCopy);
    expect(draft).toContain("채팅 반영");
    expect(draft).toContain("정기적금 상품설명서");
  });

  it("generates an opinion draft from analyzed issues when no chat context is selected", () => {
    const draft = generateIssueBasedOpinionDraft(review);

    expect(draft).toContain("수정 요청 의견 초안");
    expect(draft).toContain(issue.title);
    expect(draft).toContain(issue.targetText);
    expect(draft).toContain(issue.description);
    expect(draft).toContain(issue.suggestedCopy);
    expect(draft).toContain(issue.evidence[0].title);
  });
});

describe("chatProgressLabel", () => {
  it("returns the event label for a stage event", () => {
    expect(
      chatProgressLabel({ type: "stage", stage: "searching_knowledge", label: "등록된 지식문서 검색 중" })
    ).toBe("등록된 지식문서 검색 중");
  });

  it("returns the default label for null, done, or error events", () => {
    expect(chatProgressLabel(null)).toBe("답변 생성 중");
    expect(chatProgressLabel({ type: "error", message: "x" })).toBe("답변 생성 중");
  });
});

describe("multilingual opinion draft", () => {
  const review = getReviewCaseById("rc-demo-deposit-001")!;

  function reviewWithMultilingualIssue(context: MultilingualIssueContext): ReviewCase {
    return {
      ...review,
      issues: [{ ...review.issues[0], multilingualContext: context }]
    };
  }

  it("detects Korean by default when no multilingual context exists", () => {
    expect(detectReviewDraftLanguage(review)).toBe("ko");
  });

  it("detects the dominant non-Korean language from issue multilingual context", () => {
    expect(detectReviewDraftLanguage(reviewWithMultilingualIssue(vietnameseContext))).toBe("vi");
  });

  it("writes the opinion draft in the detected language using original-language wording", () => {
    const draft = generateIssueBasedOpinionDraft(reviewWithMultilingualIssue(vietnameseContext));

    // Section labels are localized to the detected language.
    expect(draft).toContain("Bản nháp ý kiến yêu cầu chỉnh sửa");
    expect(draft).toContain("Mức độ rủi ro");
    expect(draft).toContain("Ý kiến tổng hợp:");
    expect(draft).not.toContain("수정 요청 의견 초안");

    // Target text and suggestion come from the original-language fields.
    expect(draft).toContain(vietnameseContext.originalText);
    expect(draft).toContain(vietnameseContext.suggestedCopyOriginalLanguage);
  });

  it("localizes the chat reflection note to the detected language", () => {
    const multilingualReview = reviewWithMultilingualIssue(vietnameseContext);
    const response = answerReviewQuestion({
      review: multilingualReview,
      issue: multilingualReview.issues[0],
      question: "우대금리 조건을 어느 수준까지 표시해야 하나요?"
    });

    const draft = generateDraftWithChatContext(multilingualReview, [response]);

    expect(draft).toContain("Bối cảnh trò chuyện:");
    expect(draft).not.toContain("채팅 반영");
  });
});
