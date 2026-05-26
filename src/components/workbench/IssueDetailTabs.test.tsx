import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueDetailTabs } from "./IssueDetailTabs";
import type { ReviewIssue } from "@/domain/types";

const issue: ReviewIssue = {
  id: "issue-1",
  issueType: "claim",
  riskLevel: "high",
  title: "title",
  targetText: "text",
  targetBbox: [0, 0, 0, 0],
  sourceAgents: [],
  suggestedAction: "change_request",
  status: "open",
  description: "desc",
  suggestedCopy: "수정 제안",
  evidence: [
    {
      id: "e1",
      sourceType: "law",
      title: "Law 1",
      section: "§1",
      quoteSummary: "summary",
      relevanceScore: 0.9
    }
  ]
};

describe("IssueDetailTabs", () => {
  it("renders three tabs", () => {
    render(
      <IssueDetailTabs
        issue={issue}
        activeTab="checklist"
        onTabChange={() => undefined}
        reviewerRiskLevel="high"
        reviewerComment=""
        savedDecision={null}
        canMutate
        canFinalize={false}
        isSavingDecision={false}
        isFinalizingReview={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
        onFinalizeReviewCase={() => undefined}
      />
    );
    expect(screen.getByRole("tab", { name: "체크리스트" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "근거 자료" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "의견서" })).toBeInTheDocument();
  });

  it("notifies onTabChange when a tab is clicked", async () => {
    const onChange = vi.fn();
    render(
      <IssueDetailTabs
        issue={issue}
        activeTab="checklist"
        onTabChange={onChange}
        reviewerRiskLevel="high"
        reviewerComment=""
        savedDecision={null}
        canMutate
        canFinalize={false}
        isSavingDecision={false}
        isFinalizingReview={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
        onFinalizeReviewCase={() => undefined}
      />
    );
    await userEvent.click(screen.getByRole("tab", { name: "근거 자료" }));
    expect(onChange).toHaveBeenCalledWith("evidence");
  });

  it("renders evidence title and quote with overflow-safe classes", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          evidence: [
            {
              ...issue.evidence[0],
              title: "high-rate-deposit-review.zip/poster_high_rate_deposit.html",
              quoteSummary:
                "JB 슈퍼씨드 적금 홍보 시안 광주은행 모바일 전용 누구나 받을 수 있는 최고 연 5.0% 적금"
            }
          ]
        }}
        activeTab="evidence"
        onTabChange={() => undefined}
        reviewerRiskLevel="high"
        reviewerComment=""
        savedDecision={null}
        canMutate
        canFinalize={false}
        isSavingDecision={false}
        isFinalizingReview={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
        onFinalizeReviewCase={() => undefined}
      />
    );

    expect(
      screen.getByText("high-rate-deposit-review.zip/poster_high_rate_deposit.html")
    ).toHaveClass("evidence-card__title");
    expect(screen.getByText(/JB 슈퍼씨드 적금 홍보 시안/)).toHaveClass("evidence-card__quote");
  });
});
