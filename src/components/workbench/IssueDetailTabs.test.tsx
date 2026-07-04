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
      screen.getByText("high-rate-deposit-review.zip/poster_high_rate_deposit.html §1")
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
            suggestedCopyKoreanMeaning: "3분 신청 가능. 승인은 신용심사 결과에 따라 달라질 수 있음."
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
    expect(
      screen.queryByText("3분 신청 가능. 승인은 신용심사 결과에 따라 달라질 수 있음.")
    ).not.toBeInTheDocument();
  });

  it("labels social-context risk issues in the checklist summary", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          issueType: "SOCIAL_CONTEXT_SENSITIVE_DATE",
          sourceAgents: ["social_context_risk"],
          evidence: [
            {
              id: "ev-social-date",
              sourceType: "internal_policy",
              title: "01_민감_날짜_기념일_체크리스트.md",
              quoteSummary: "민감 날짜와 기념일 인접 집행 여부를 확인한다.",
              relevanceScore: 0.83
            }
          ]
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

    expect(screen.getByText("사회맥락 리스크")).toHaveClass("issue-agent-badge");
  });

  it("does not show the social-context badge without approved social-context evidence", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          issueType: "SOCIAL_CONTEXT_CONSUMER_SENTIMENT",
          sourceAgents: ["social_context_risk"],
          evidence: [
            {
              id: "ev-generic-common-checklist",
              sourceType: "internal_policy",
              title: "금융상품 광고 준법심의 공통 체크리스트",
              quoteSummary: "소비자 정서와 사회적 논란 가능성을 고려해 오인 표현을 점검해야 한다.",
              relevanceScore: 0.81
            }
          ]
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

    expect(screen.queryByText("사회맥락 리스크")).not.toBeInTheDocument();
  });

  it("does not label non-social agent sources in the checklist summary", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          sourceAgents: ["product_terms", "regulation"]
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

    // 사회맥락 리스크만 태깅한다. 그 외 에이전트 출처는 배지로 표시하지 않는다.
    expect(screen.queryByText("상품조건")).not.toBeInTheDocument();
    expect(screen.queryByText("법령")).not.toBeInTheDocument();
  });

  it("labels social-context evidence as social-context criteria", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          evidence: [
            {
              id: "ev-social-campaign-name",
              sourceType: "internal_policy",
              title: "03_문구_캠페인명_체크리스트.md",
              quoteSummary: "군사적, 공격적 표현은 캠페인명과 문구의 사회맥락을 확인한다.",
              relevanceScore: 0.2
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

    expect(screen.getByText("사회맥락 기준")).toBeInTheDocument();
    expect(screen.getByText("03_문구_캠페인명_체크리스트.md")).toBeInTheDocument();
  });

  it("keeps generic compliance evidence under the normal internal criteria label", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          evidence: [
            {
              id: "ev-generic-common-checklist",
              sourceType: "internal_policy",
              title: "금융상품 광고 준법심의 공통 체크리스트",
              quoteSummary: "소비자 정서와 사회적 논란 가능성을 고려해 오인 표현을 점검해야 한다.",
              relevanceScore: 0.81
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

    expect(screen.getByText("내부 기준")).toBeInTheDocument();
    expect(screen.queryByText("사회맥락 기준")).not.toBeInTheDocument();
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
    expect(screen.getByText("자본시장법 시행령 제68조 제5항")).toBeInTheDocument();
    expect(screen.queryByText(/참고해 판단했습니다/)).not.toBeInTheDocument();
    expect(screen.getByText("판단 근거")).toBeInTheDocument();
    expect(screen.getByText(/수익률과 우대 조건은 소비자가 오인하지 않도록/)).toBeInTheDocument();
    expect(screen.getByText("법령")).toBeInTheDocument();
    expect(screen.queryByText("law")).not.toBeInTheDocument();
  });

  it("renders upload document evidence for upload-only evidence", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          evidence: [
            {
              id: "evidence-uploaded-ad",
              sourceType: "product_doc",
              title: "대출광고1.png",
              quoteSummary: "신용등급 무관 당일 심사! 즉시 승인!",
              relevanceScore: 0.86
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

    expect(screen.getByText("업로드 자료 근거")).toBeInTheDocument();
    expect(screen.getByText("대출광고1.png")).toBeInTheDocument();
    expect(screen.getByText("신용등급 무관 당일 심사! 즉시 승인!")).toBeInTheDocument();
    expect(screen.getByText("업로드 자료")).toBeInTheDocument();
    expect(screen.getByText("규정/내규 근거")).toBeInTheDocument();
    expect(screen.getByText("연결된 승인 지식문서 없음")).toBeInTheDocument();
    expect(
      screen.getByText(
        "현재 이슈는 업로드 광고 표현을 기준으로 AI가 위험 신호를 판단했으며, 적용 규정/내규 근거는 리뷰어 확인이 필요합니다."
      )
    ).toBeInTheDocument();
  });

  it("extracts an article reference from registered knowledge text when section metadata is absent", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          evidence: [
            {
              id: "knowledge-guideline-001",
              sourceType: "internal_policy",
              documentId: "doc-financial-ad-guideline",
              chunkId: "chunk-financial-ad-guideline-8-3",
              title: "금융규제 가이드라인",
              quoteSummary:
                "8조제3항 각 호의 내용 중 일부를 제외함으로 인해 금융소비자의 합리적 의사결정이 저해될 우려가 없을 것",
              relevanceScore: 0.79
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

    expect(screen.getByText("금융규제 가이드라인 제8조제3항")).toBeInTheDocument();
  });

  it("does not render table-of-contents dot leaders in evidence reasoning", () => {
    render(
      <IssueDetailTabs
        issue={{
          ...issue,
          evidence: [
            {
              id: "knowledge-guideline-toc",
              sourceType: "internal_policy",
              documentId: "doc-financial-ad-guideline",
              chunkId: "chunk-financial-ad-guideline-toc",
              title: "금융규제 가이드라인",
              quoteSummary:
                "별첨자료 금융광고규제 가이드라인 2021. 6. 8. 목 차 Ⅰ. 금소법 제정에 따른 광고규제 변화 · ·· ·· ·· ·· ·· 1 Ⅱ. 광고규제 적용대상 · ·· ·· ·· ·· ·· 3",
              relevanceScore: 0.62
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

    expect(screen.getByText("금융규제 가이드라인")).toBeInTheDocument();
    expect(
      screen.getByText("등록된 지식문서의 조항 본문을 기준으로 판단했습니다.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/목 차/)).not.toBeInTheDocument();
    expect(screen.queryByText(/··/)).not.toBeInTheDocument();
  });

  it("renders the regulatory empty state for completed issues that have no persisted evidence", () => {
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

    expect(screen.getByText("규정/내규 근거")).toBeInTheDocument();
    expect(screen.getByText("연결된 승인 지식문서 없음")).toBeInTheDocument();
    expect(screen.queryByText("AI 분석 결과")).not.toBeInTheDocument();
    expect(screen.queryByText("참고 출처")).not.toBeInTheDocument();
    expect(screen.queryByText("판단 근거")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "현재 이슈는 업로드 광고 표현을 기준으로 AI가 위험 신호를 판단했으며, 적용 규정/내규 근거는 리뷰어 확인이 필요합니다."
      )
    ).toBeInTheDocument();
  });
});
