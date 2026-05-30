import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreativeViewer } from "./CreativeViewer";
import type { ReviewIssue } from "@/domain/types";

const issue: ReviewIssue = {
  id: "issue-1",
  issueType: "claim",
  riskLevel: "high",
  title: "title",
  targetText: "text",
  targetBbox: [10, 10, 20, 8],
  sourceAgents: [],
  suggestedAction: "change_request",
  status: "open",
  description: "",
  suggestedCopy: "",
  evidence: []
};

describe("CreativeViewer", () => {
  it("fires onSelectIssue when a highlight box is clicked", async () => {
    const onSelect = vi.fn();
    render(
      <CreativeViewer
        copy="카피"
        disclosure="공시"
        issues={[issue]}
        selectedIssueId="issue-1"
        onSelectIssue={onSelect}
      />
    );
    await userEvent.click(screen.getByTitle("title"));
    expect(onSelect).toHaveBeenCalledWith("issue-1");
  });

  it("renders an uploaded promotional creative image instead of the mock poster", () => {
    render(
      <CreativeViewer
        copy="실제 업로드 자료 분석 대기"
        disclosure="mock disclosure"
        creativeImage={{
          src: "blob:http://localhost/uploaded-poster",
          alt: "poster_mirae_loan.png"
        }}
        issues={[]}
        onSelectIssue={vi.fn()}
      />
    );

    expect(
      screen.getByRole("img", { name: "poster_mirae_loan.png 실제 심의자료 포스터" })
    ).toHaveAttribute("src", "blob:http://localhost/uploaded-poster");
    expect(screen.queryByText("FinProof Bank")).not.toBeInTheDocument();
    expect(screen.queryByText("실제 업로드 자료 분석 대기")).not.toBeInTheDocument();
  });
});
