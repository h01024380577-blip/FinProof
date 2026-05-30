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

  it("zooms the creative preview in and out from the toolbar", async () => {
    render(
      <CreativeViewer
        copy="카피"
        disclosure="공시"
        issues={[]}
        onSelectIssue={vi.fn()}
      />
    );

    const user = userEvent.setup();
    const zoomStage = screen.getByTestId("creative-viewer-zoom-stage");

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(zoomStage).toHaveStyle({ "--viewer-zoom": "1" });

    await user.click(screen.getByRole("button", { name: "확대" }));

    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(zoomStage).toHaveStyle({ "--viewer-zoom": "1.25" });

    await user.click(screen.getByRole("button", { name: "축소" }));

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(zoomStage).toHaveStyle({ "--viewer-zoom": "1" });
  });

  it("toggles fullscreen mode from the toolbar", async () => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn()
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn()
    });
    const requestFullscreen = vi
      .spyOn(HTMLElement.prototype, "requestFullscreen")
      .mockResolvedValue(undefined);
    const exitFullscreen = vi.spyOn(document, "exitFullscreen").mockResolvedValue(undefined);

    render(
      <CreativeViewer
        copy="카피"
        disclosure="공시"
        issues={[]}
        onSelectIssue={vi.fn()}
      />
    );

    const user = userEvent.setup();
    const viewer = screen.getByLabelText("문서 미리보기");

    await user.click(screen.getByRole("button", { name: "전체 화면" }));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(viewer).toHaveAttribute("data-fullscreen", "true");
    expect(screen.getByRole("button", { name: "전체 화면 종료" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "전체 화면 종료" }));

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(viewer).toHaveAttribute("data-fullscreen", "false");

    requestFullscreen.mockRestore();
    exitFullscreen.mockRestore();
  });
});
