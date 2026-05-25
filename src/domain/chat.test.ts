import { answerReviewQuestion, generateDraftWithChatContext } from "./chat";
import { getReviewCaseById } from "./reviews";

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

    expect(draft).toContain(review.expectedDraft);
    expect(draft).toContain("채팅 반영");
    expect(draft).toContain("정기적금 상품설명서");
  });
});
