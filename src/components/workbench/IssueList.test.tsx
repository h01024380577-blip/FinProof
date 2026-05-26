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
});
