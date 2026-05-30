import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueueTable } from "./QueueTable";
import type { ReviewSummary } from "@/domain/types";

const baseRow: ReviewSummary = {
  id: "RC-2026-001",
  title: "최고 연 5.0% 적금 홍보물 심의",
  affiliate: "광주은행",
  productType: "deposit",
  plannedPublishDate: "2026-06-10",
  status: "analysis_waiting",
  highestRiskLevel: "info",
  requester: "김요청",
  reviewer: "박심의"
};

describe("QueueTable", () => {
  it("renders header and rows", () => {
    render(
      <QueueTable
        rows={[baseRow]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );
    expect(screen.getByText("심의 ID")).toBeInTheDocument();
    expect(screen.getByText("RC-2026-001")).toBeInTheDocument();
  });

  it("lets reviewers edit and save the assigned reviewer without opening the row", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onSaveReviewer = vi.fn();

    render(
      <QueueTable
        rows={[{ ...baseRow, status: "analysis_complete" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        canEditReviewer
        onSaveReviewer={onSaveReviewer}
        onStartAnalysis={() => undefined}
        onOpenReview={onOpen}
      />
    );

    const reviewerInput = screen.getByLabelText("담당자: 최고 연 5.0% 적금 홍보물 심의");
    await user.clear(reviewerInput);
    await user.type(reviewerInput, "준법심의자 이수민");
    await user.tab();

    expect(onSaveReviewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "RC-2026-001" }),
      "준법심의자 이수민"
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("uses the waiting list label while loading rows", () => {
    render(
      <QueueTable
        rows={[]}
        activeRole="reviewer"
        activeAnalysisId={null}
        isLoading
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    const loadingMessage = screen.getByText("심의 대기 목록을 불러오는 중입니다.");
    expect(loadingMessage).toBeInTheDocument();
    expect(
      loadingMessage.closest(".queue-empty-state")?.querySelector(".action-spinner")
    ).toBeInTheDocument();
    expect(screen.queryByText("심의 큐를 불러오는 중입니다.")).not.toBeInTheDocument();
  });

  it("uses the history label with a spinner while loading history rows", () => {
    render(
      <QueueTable
        rows={[]}
        activeRole="reviewer"
        activeAnalysisId={null}
        isLoading
        loadingMessage="심의 이력을 불러오는 중입니다."
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    const loadingMessage = screen.getByText("심의 이력을 불러오는 중입니다.");
    expect(loadingMessage).toBeInTheDocument();
    expect(
      loadingMessage.closest(".queue-empty-state")?.querySelector(".action-spinner")
    ).toBeInTheDocument();
  });

  it("fires onStartAnalysis when reviewer clicks start button on analysis_waiting row", async () => {
    const onStart = vi.fn();
    render(
      <QueueTable
        rows={[baseRow]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={onStart}
        onOpenReview={() => undefined}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /AI 분석 시작/ }));
    expect(onStart).toHaveBeenCalledWith(baseRow);
  });

  it("shows unassigned reviewer rows without a hardcoded default name", () => {
    render(
      <QueueTable
        rows={[{ ...baseRow, reviewer: "" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        canEditReviewer
        onSaveReviewer={() => undefined}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    expect(screen.getByLabelText("담당자: 최고 연 5.0% 적금 홍보물 심의")).toHaveAttribute(
      "placeholder",
      "미배정"
    );
    expect(screen.queryByText("준법심의자 박민준")).not.toBeInTheDocument();
  });

  it("labels the active analysis action as analyzing", () => {
    render(
      <QueueTable
        rows={[baseRow]}
        activeRole="reviewer"
        activeAnalysisId={baseRow.id}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    const analyzingButton = screen.getByRole("button", { name: "분석중" });
    expect(analyzingButton).toBeDisabled();
    expect(analyzingButton.querySelector(".action-spinner")).toBeInTheDocument();
    expect(screen.queryByText("시작 중")).not.toBeInTheDocument();
  });

  it("shows work status text in the work column while keeping the analysis button action", () => {
    render(
      <QueueTable
        rows={[{ ...baseRow, reviewer: "" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    const row = screen.getByRole("row", { name: /최고 연 5.0%/ });
    const cells = within(row).getAllByRole("cell");

    expect(cells[8]).toHaveTextContent("분석 대기");
    expect(within(cells[9]).getByRole("button", { name: "AI 분석 시작" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "담당자 확인 후 AI 분석" })).not.toBeInTheDocument();
  });

  it("navigates via row click when case is openable", async () => {
    const onOpen = vi.fn();
    render(
      <QueueTable
        rows={[{ ...baseRow, status: "analysis_complete" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={() => undefined}
        onOpenReview={onOpen}
      />
    );
    await userEvent.click(screen.getByRole("row", { name: /최고 연 5.0%/ }));
    expect(onOpen).toHaveBeenCalledWith("RC-2026-001");
  });

  it("shows a trash action for deletable history rows without opening the row", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onDeleteReviewHistory = vi.fn();

    render(
      <QueueTable
        rows={[{ ...baseRow, status: "approved" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        canDeleteReviewHistory
        onDeleteReviewHistory={onDeleteReviewHistory}
        onStartAnalysis={() => undefined}
        onOpenReview={onOpen}
      />
    );

    await user.click(screen.getByRole("button", { name: "심의 이력 삭제: 최고 연 5.0% 적금 홍보물 심의" }));

    expect(onDeleteReviewHistory).toHaveBeenCalledWith(expect.objectContaining({ id: "RC-2026-001" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("marks rejected history status with a rejected status tone", () => {
    render(
      <QueueTable
        rows={[
          {
            ...baseRow,
            id: "RC-REJECTED-001",
            title: "반려 완료된 신용대출 홍보물",
            status: "rejected",
            highestRiskLevel: "reject_recommended"
          }
        ]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    expect(screen.getAllByText("반려")[0]).toHaveAttribute("data-status", "rejected");
  });
});
