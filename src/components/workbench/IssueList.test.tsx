import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueList } from "./IssueList";
import type { ReviewIssue } from "@/domain/types";

const issues: ReviewIssue[] = [
  {
    id: "issue-1",
    issueType: "claim",
    riskLevel: "high",
    title: "최고 연 5.0% 조건 표시 부족",
    targetText: "최고 연 5.0% 적금!",
    targetBbox: [10, 10, 30, 8],
    sourceAgents: [],
    suggestedAction: "change_request",
    status: "open",
    description: "...",
    suggestedCopy: "...",
    evidence: []
  }
];

describe("IssueList", () => {
  it("renders issues with risk filter", async () => {
    const onSelect = vi.fn();
    render(<IssueList issues={issues} selectedIssueId="issue-1" onSelectIssue={onSelect} />);
    expect(screen.getByText("최고 연 5.0% 조건 표시 부족")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /최고 연 5.0%/ }));
    expect(onSelect).toHaveBeenCalledWith("issue-1");
  });

  it("filters by risk level chip", async () => {
    const issuesMix: ReviewIssue[] = [
      { ...issues[0], id: "h", riskLevel: "high", title: "High issue" },
      { ...issues[0], id: "i", riskLevel: "info", title: "Info issue" }
    ];
    render(<IssueList issues={issuesMix} selectedIssueId="h" onSelectIssue={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "위험" }));
    expect(screen.getByText("High issue")).toBeInTheDocument();
    expect(screen.queryByText("Info issue")).not.toBeInTheDocument();
  });

  it("sorts mapped issues by risk severity descending (위험 → 주의 → 참고)", () => {
    const mixed: ReviewIssue[] = [
      { ...issues[0], id: "info-1", riskLevel: "info", title: "Info A" },
      { ...issues[0], id: "high-1", riskLevel: "high", title: "High A" },
      { ...issues[0], id: "caution-1", riskLevel: "caution", title: "Caution A" },
      { ...issues[0], id: "high-2", riskLevel: "high", title: "High B" }
    ];
    render(<IssueList issues={mixed} onSelectIssue={() => undefined} />);

    const titles = Array.from(document.querySelectorAll(".issue-card__title")).map(
      (el) => el.textContent
    );
    // high first (stable: A before B), then caution, then info.
    expect(titles).toEqual(["High A", "High B", "Caution A", "Info A"]);
  });

  it("separates long card title and excerpt for stable scroll layout", () => {
    render(
      <IssueList
        issues={[
          {
            ...issues[0],
            title: '"누구나 받을 수 있는 최고 연 5.0%" 표현의 금리 오인 가능성',
            targetText:
              "신규 가입 고객에게 선착순 특별 우대금리를 제공합니다. 단, 조건과 한도는 별도 확인이 필요합니다."
          }
        ]}
        selectedIssueId="issue-1"
        onSelectIssue={() => undefined}
      />
    );

    expect(
      screen.getByText('"누구나 받을 수 있는 최고 연 5.0%" 표현의 금리 오인 가능성')
    ).toHaveClass("issue-card__title");
    expect(screen.getByText(/신규 가입 고객에게 선착순/)).toHaveClass("issue-card__excerpt");
  });

  it("uses whole-card color state without risk text or marker lines", () => {
    render(<IssueList issues={issues} selectedIssueId="issue-1" onSelectIssue={() => undefined} />);

    const card = screen.getByRole("button", { name: /최고 연 5.0% 조건 표시 부족/ });
    expect(within(card).queryByText("위험")).not.toBeInTheDocument();
    expect(card.querySelector(".issue-card__risk-marker")).not.toBeInTheDocument();
    expect(card).toHaveAttribute("data-risk", "high");
    expect(card.getAttribute("style")).toContain("--issue-card-min-height");
  });

  it("keeps short issue cards compact", () => {
    render(<IssueList issues={issues} selectedIssueId="issue-1" onSelectIssue={() => undefined} />);

    expect(screen.getByRole("button", { name: /최고 연 5.0% 조건 표시 부족/ })).toHaveStyle({
      "--issue-card-min-height": "108px"
    });
  });

  it("places the issue number in a leading index slot", () => {
    render(<IssueList issues={issues} selectedIssueId="issue-1" onSelectIssue={() => undefined} />);

    const card = screen.getByRole("button", { name: /최고 연 5.0% 조건 표시 부족/ });
    expect(within(card).getByText("#1")).toHaveClass("issue-card__index");
  });

  it("labels social-context issues without changing the risk label model", () => {
    render(
      <IssueList
        issues={[
          {
            ...issues[0],
            issueType: "SOCIAL_CONTEXT_SYMBOL_DATE",
            sourceAgents: ["social_context_risk"],
            title: "민감일과 캠페인명 충돌 가능성",
            evidence: [
              {
                id: "ev-social-campaign-name",
                sourceType: "internal_policy",
                title: "03_문구_캠페인명_체크리스트.md",
                quoteSummary: "군사적, 공격적 표현은 캠페인명과 문구의 사회맥락을 확인한다.",
                relevanceScore: 0.82
              }
            ]
          }
        ]}
        selectedIssueId="issue-1"
        onSelectIssue={() => undefined}
      />
    );

    const card = screen.getByRole("button", { name: /민감일과 캠페인명/ });
    expect(within(card).getByText("사회맥락")).toHaveClass("issue-card__agent-badge");
    expect(within(card).queryByText("위험")).not.toBeInTheDocument();
  });

  it("does not label generic policy findings as social-context issues", () => {
    render(
      <IssueList
        issues={[
          {
            ...issues[0],
            issueType: "SOCIAL_CONTEXT_CONSUMER_SENTIMENT",
            sourceAgents: ["social_context_risk"],
            title: "최고금리 표시 소비자 오인 가능성",
            evidence: [
              {
                id: "ev-generic-deposit-policy",
                sourceType: "internal_policy",
                title: "예금·적금 광고 심의 체크리스트",
                quoteSummary:
                  "최고 금리 표시 시 우대조건과 기본금리를 병기해야 소비자 오인을 줄일 수 있다.",
                relevanceScore: 0.83
              }
            ]
          }
        ]}
        selectedIssueId="issue-1"
        onSelectIssue={() => undefined}
      />
    );

    const card = screen.getByRole("button", { name: /최고금리 표시/ });
    expect(within(card).queryByText("사회맥락")).not.toBeInTheDocument();
  });

  it("labels non-social agent sources on issue cards", () => {
    render(
      <IssueList
        issues={[
          {
            ...issues[0],
            sourceAgents: ["product_terms", "regulation"],
            title: "상품 조건과 법령 근거 확인 필요"
          }
        ]}
        selectedIssueId="issue-1"
        onSelectIssue={() => undefined}
      />
    );

    const card = screen.getByRole("button", { name: /상품 조건과 법령/ });
    expect(within(card).getByText("상품")).toHaveClass("issue-card__agent-badge");
    expect(within(card).getByText("법령")).toHaveClass("issue-card__agent-badge");
  });

  it("does not show the manual issue button by default", () => {
    render(<IssueList issues={issues} selectedIssueId="issue-1" onSelectIssue={() => undefined} />);

    expect(screen.queryByRole("button", { name: "이슈 직접 추가" })).not.toBeInTheDocument();
  });

  it("renders an empty issue list with the manual issue affordance", async () => {
    const onAdd = vi.fn();
    render(
      <IssueList
        issues={[]}
        onSelectIssue={() => undefined}
        canAddManualIssue
        onAddManualIssue={onAdd}
      />
    );

    expect(screen.getByText("이슈 목록 (0)")).toBeInTheDocument();
    expect(screen.getByText("추가 확인 필요")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "이슈 직접 추가" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
