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
      screen.getByText(
        "high-rate-deposit-review.zip/poster_high_rate_deposit.html §1을 참고해 판단했습니다."
      )
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

  it("renders issue evidence as a cited judgment source instead of a raw file listing", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          title: "최고 금리 조건 병기 필요",
          evidence: [
            {
              id: "knowledge-law-capital-001",
              sourceType: "law",
              documentId: "doc-capital-enforcement",
              chunkId: "chunk-capital-enforcement-68-5",
              title: "자본시장법 시행령",
              section: "제68조 제5항",
              quoteSummary: "수익률과 우대 조건은 소비자가 오인하지 않도록 인접 표시해야 합니다.",
              relevanceScore: 0.91
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

    expect(screen.getByText("참고 출처")).toBeInTheDocument();
    expect(
      screen.getByText("자본시장법 시행령 제68조 제5항을 참고해 판단했습니다.")
    ).toBeInTheDocument();
    expect(screen.getByText("판단 근거")).toBeInTheDocument();
    expect(screen.getByText(/수익률과 우대 조건은 소비자가 오인하지 않도록/)).toBeInTheDocument();
    expect(screen.getByText("법령")).toBeInTheDocument();
    expect(screen.queryByText("law")).not.toBeInTheDocument();
  });

  it("renders the cited source layout for completed issues that have no persisted evidence", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          evidence: [],
          title: "최고 금리 조건 병기 필요",
          description: "최고 금리 표현이 확인되었지만 적용 조건이 함께 확인되지 않았습니다."
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

    expect(screen.getByText("AI 분석 결과")).toBeInTheDocument();
    expect(screen.getByText("참고 출처")).toBeInTheDocument();
    expect(screen.getByText("AI 분석 결과를 참고해 판단했습니다.")).toBeInTheDocument();
    expect(screen.getByText("판단 근거")).toBeInTheDocument();
    expect(screen.getByText("최고 금리 표현이 확인되었지만 적용 조건이 함께 확인되지 않았습니다.")).toBeInTheDocument();
  });
});
