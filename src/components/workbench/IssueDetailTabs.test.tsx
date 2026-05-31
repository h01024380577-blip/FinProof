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
        isSavingDecision={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
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
        isSavingDecision={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
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
        isSavingDecision={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
      />
    );

    expect(
      screen.getByText("high-rate-deposit-review.zip/poster_high_rate_deposit.html")
    ).toHaveClass("evidence-card__title");
    expect(screen.getByText(/JB 슈퍼씨드 적금 홍보 시안/)).toHaveClass("evidence-card__quote");
  });

  it("renders multilingual review context in the checklist panel", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          multilingualContext: {
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval in 3 minutes",
            literalTranslation: "3분 안에 승인 보장",
            complianceMeaning: "심사와 무관하게 승인 확정처럼 해석될 수 있음",
            riskCategory: "both",
            riskSignals: ["approval_guarantee", "instant_approval"],
            koreanComplianceCategory: "승인 보장 오인 표현",
            koreanComplianceReason: "대출 승인 가능성을 확정적으로 고지하는 표현으로 볼 수 있음",
            evidenceQuery: "대출 광고 승인 보장 금지 표현",
            suggestedCopyOriginalLanguage:
              "Apply in 3 minutes. Approval is subject to credit review.",
            suggestedCopyKoreanMeaning:
              "3분 신청 가능. 승인은 신용심사 결과에 따라 달라질 수 있음."
          }
        }}
        activeTab="checklist"
        onTabChange={() => undefined}
        reviewerRiskLevel="high"
        reviewerComment=""
        savedDecision={null}
        canMutate
        isSavingDecision={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
      />
    );

    expect(screen.getByText("원문 표현")).toBeInTheDocument();
    expect(screen.getByText("Guaranteed approval in 3 minutes")).toBeInTheDocument();
    expect(screen.queryByText("3분 안에 승인 보장")).not.toBeInTheDocument();
    expect(screen.getByText("approval_guarantee")).toBeInTheDocument();
    expect(screen.getByText("승인 보장 오인 표현")).toBeInTheDocument();
    expect(
      screen.getByText("Apply in 3 minutes. Approval is subject to credit review.")
    ).toBeInTheDocument();
    expect(screen.queryByText("3분 신청 가능. 승인은 신용심사 결과에 따라 달라질 수 있음.")).not.toBeInTheDocument();
  });

  it("formats evidence metadata in Korean and hides missing location fields", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          evidence: [
            {
              ...issue.evidence[0],
              page: undefined,
              section: "",
              relevanceScore: 0.76
            }
          ]
        }}
        activeTab="evidence"
        onTabChange={() => undefined}
        reviewerRiskLevel="high"
        reviewerComment=""
        savedDecision={null}
        canMutate
        isSavingDecision={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
      />
    );

    expect(screen.getByText("관련도 76%")).toBeInTheDocument();
    expect(screen.queryByText(/p\.-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/relevance/)).not.toBeInTheDocument();
    expect(screen.queryByText(/·\s*·/)).not.toBeInTheDocument();
  });
});
