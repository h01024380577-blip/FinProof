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

  it("only highlights the selected issue target on the creative", () => {
    render(
      <CreativeViewer
        copy="카피"
        disclosure="공시"
        issues={[
          { ...issue, id: "issue-1", title: "첫 번째 위험 문구" },
          {
            ...issue,
            id: "issue-2",
            title: "선택된 위험 문구",
            targetText: "누구나 빠르게 승인",
            targetBbox: [30, 24, 36, 10]
          }
        ]}
        selectedIssueId="issue-2"
        onSelectIssue={vi.fn()}
      />
    );

    expect(screen.queryByTitle("첫 번째 위험 문구")).not.toBeInTheDocument();
    expect(screen.getByTitle("선택된 위험 문구")).toHaveAttribute("data-active", "true");
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

  it("shows an explicit load-failure notice instead of the mock poster when the uploaded creative image fails to load", () => {
    render(
      <CreativeViewer
        copy="심의 요청 제목: CoVe"
        disclosure="실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다."
        creativeImageError
        issues={[]}
        onSelectIssue={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("원본 이미지를 불러오지 못했습니다");
    // The reviewer must not be shown the intake placeholder as if it were the real creative.
    expect(screen.queryByText("FinProof Bank")).not.toBeInTheDocument();
    expect(screen.queryByText("심의 요청 제목: CoVe")).not.toBeInTheDocument();
  });

  it("prefers the loaded creative image over the load-failure notice", () => {
    render(
      <CreativeViewer
        copy="카피"
        disclosure="공시"
        creativeImage={{ src: "blob:http://localhost/poster", alt: "poster.png" }}
        creativeImageError
        issues={[]}
        onSelectIssue={vi.fn()}
      />
    );

    expect(screen.getByRole("img", { name: "poster.png 실제 심의자료 포스터" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

  it("fits the creative preview to its own viewer frame from the toolbar", async () => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn()
    });
    const requestFullscreen = vi
      .spyOn(HTMLElement.prototype, "requestFullscreen")
      .mockResolvedValue(undefined);

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
    const zoomStage = screen.getByTestId("creative-viewer-zoom-stage");

    await user.click(screen.getByRole("button", { name: "페이지 맞추기" }));

    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(viewer).toHaveAttribute("data-frame-fit", "true");
    expect(zoomStage).toHaveAttribute("data-frame-fit", "true");
    expect(screen.getByRole("button", { name: "페이지 맞추기 해제" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "페이지 맞추기 해제" }));

    expect(viewer).toHaveAttribute("data-frame-fit", "false");
    expect(zoomStage).toHaveAttribute("data-frame-fit", "false");

    requestFullscreen.mockRestore();
  });
});
