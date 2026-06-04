import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

function queueTableMinimumWidth(): number {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const block = queueGridCssBlock(css);
  const minTrackWidths = [...block.matchAll(/minmax\((\d+)px,/g)].map((match) => Number(match[1]));
  const gap = Number(block.match(/gap:\s*(\d+)px/)?.[1] ?? 12);
  const padding = block.match(/padding:\s*0\s+(\d+)px/);
  const horizontalPadding = padding ? Number(padding[1]) * 2 : 36;

  return minTrackWidths.reduce((sum, width) => sum + width, 0) + gap * 9 + horizontalPadding;
}

function queueGridCssBlock(css: string): string {
  return (
    css.match(/\.review-table--queue \.review-table__row \{(?<body>[\s\S]*?)\n\}/)?.groups?.body ??
    ""
  );
}

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

  it("shows the requester column between request department and status", () => {
    render(
      <QueueTable
        rows={[{ ...baseRow, requester: "마케팅 담당자 김지현" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "심의 ID",
      "제목",
      "상품군",
      "요청 부서",
      "요청자",
      "상태",
      "위험도",
      "마감일",
      "담당자",
      "작업"
    ]);

    const rowCells = within(screen.getByRole("row", { name: /최고 연 5.0%/ })).getAllByRole("cell");
    expect(rowCells).toHaveLength(10);
    expect(rowCells[3]).toHaveTextContent("마케팅팀");
    expect(rowCells[4]).toHaveTextContent("마케팅 담당자 김지현");
    expect(rowCells[5]).toHaveTextContent("분석 대기");
  });

  it("keeps the queue grid narrow enough for a 1366px reviewer workspace", () => {
    expect(queueTableMinimumWidth()).toBeLessThanOrEqual(996);
  });

  it("keeps queue columns compact while reserving enough action width", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const block = queueGridCssBlock(css);
    const minTrackWidths = [...block.matchAll(/minmax\((\d+)px,/g)].map((match) =>
      Number(match[1])
    );
    const gap = Number(block.match(/gap:\s*(\d+)px/)?.[1] ?? 12);
    const padding = Number(block.match(/padding:\s*0\s+(\d+)px/)?.[1] ?? 12);

    expect(gap).toBeLessThanOrEqual(4);
    expect(padding).toBeLessThanOrEqual(8);
    expect(minTrackWidths[1]).toBeLessThanOrEqual(210);
    expect(minTrackWidths[9]).toBeGreaterThanOrEqual(114);
  });

  it("allows queue titles to wrap while keeping the other compact cells on one line", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const compactCellBlock =
      css.match(
        /\.review-table--queue \.review-table__row > :not\(\.queue-row-actions\):not\(strong\)\[role="cell"\][\s\S]*?\{(?<body>[\s\S]*?)\n\}/
      )?.groups?.body ?? "";
    const titleBlock =
      css.match(
        /\.review-table--queue \.review-table__row > strong\[role="cell"\][\s\S]*?\{(?<body>[\s\S]*?)\n\}/
      )?.groups?.body ?? "";

    expect(compactCellBlock).toContain("white-space: nowrap");
    expect(compactCellBlock).toContain("text-overflow: ellipsis");
    expect(titleBlock).toContain("white-space: normal");
    expect(titleBlock).toContain("overflow-wrap: anywhere");
  });

  it("does not expose a direct reviewer editor from the queue row", () => {
    const onOpen = vi.fn();
    const onSaveReviewer = vi.fn();

    render(
      <QueueTable
        rows={[{ ...baseRow, status: "analysis_complete" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onSaveReviewer={onSaveReviewer}
        onStartAnalysis={() => undefined}
        onOpenReview={onOpen}
      />
    );

    expect(
      screen.queryByLabelText("담당자: 최고 연 5.0% 적금 홍보물 심의")
    ).not.toBeInTheDocument();
    expect(screen.getByText("박심의")).toBeInTheDocument();
    expect(onSaveReviewer).not.toHaveBeenCalled();
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

  it("renders analysis statuses as plain text with weight-only emphasis", () => {
    render(
      <QueueTable
        rows={[
          baseRow,
          {
            ...baseRow,
            id: "RC-2026-002",
            title: "분석 완료된 적금 홍보물",
            status: "analysis_complete"
          }
        ]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    const waitingBadge = within(screen.getByRole("row", { name: /최고 연 5.0%/ })).getByText(
      "분석 대기"
    );
    const completedBadge = within(screen.getByRole("row", { name: /분석 완료된 적금/ })).getByText(
      "AI 분석 완료"
    );

    expect(waitingBadge).toHaveClass("status-badge");
    expect(waitingBadge).toHaveClass("status-badge--analysis-waiting");
    expect(waitingBadge).toHaveClass("status-badge--plain");
    expect(waitingBadge).toHaveClass("status-badge--weight-regular");
    expect(waitingBadge).toHaveAttribute("data-status", "analysis_waiting");
    expect(completedBadge).toHaveClass("status-badge");
    expect(completedBadge).toHaveClass("status-badge--analysis-complete");
    expect(completedBadge).toHaveClass("status-badge--plain");
    expect(completedBadge).toHaveClass("status-badge--weight-strong");
    expect(completedBadge).toHaveAttribute("data-status", "analysis_complete");
  });

  it("shows unassigned reviewer rows as text without a hardcoded default name", () => {
    render(
      <QueueTable
        rows={[{ ...baseRow, reviewer: "" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onSaveReviewer={() => undefined}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    expect(
      screen.queryByLabelText("담당자: 최고 연 5.0% 적금 홍보물 심의")
    ).not.toBeInTheDocument();
    expect(screen.getByText("미배정")).toBeInTheDocument();
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

  it("shows the analysis action in the work column before analysis and a completed note after analysis", () => {
    render(
      <QueueTable
        rows={[
          { ...baseRow, reviewer: "" },
          {
            ...baseRow,
            id: "RC-2026-002",
            title: "분석 완료된 적금 홍보물",
            status: "analysis_complete",
            reviewer: "박심의"
          },
          {
            ...baseRow,
            id: "RC-2026-003",
            title: "AI 분석 대기 중인 적금 홍보물",
            status: "analysis_queued",
            reviewer: "박심의"
          }
        ]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    const waitingCells = within(screen.getByRole("row", { name: /최고 연 5.0%/ })).getAllByRole(
      "cell"
    );
    const completedCells = within(
      screen.getByRole("row", { name: /분석 완료된 적금/ })
    ).getAllByRole("cell");
    const queuedCells = within(
      screen.getByRole("row", { name: /AI 분석 대기 중인 적금/ })
    ).getAllByRole("cell");

    expect(waitingCells).toHaveLength(10);
    expect(waitingCells[9]).toHaveClass("queue-row-actions--left");
    expect(
      within(waitingCells[9]).getByRole("button", { name: "AI 분석 시작" })
    ).toBeInTheDocument();
    expect(queuedCells).toHaveLength(10);
    expect(queuedCells[9]).toHaveClass("queue-row-actions--left");
    expect(queuedCells[9]).toHaveTextContent("분석중");
    expect(completedCells).toHaveLength(10);
    expect(completedCells[9]).toHaveClass("queue-row-actions--left");
    expect(within(completedCells[9]).getByRole("button", { name: "검토하기" })).toHaveClass(
      "queue-row-action-button"
    );
  });

  it("opens the workbench via the 검토하기 action and reviewer confirmation", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: "검토하기" }));
    await userEvent.click(screen.getByRole("button", { name: "검토 시작" }));
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

    await user.click(
      screen.getByRole("button", { name: "심의 이력 삭제: 최고 연 5.0% 적금 홍보물 심의" })
    );

    expect(onDeleteReviewHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: "RC-2026-001" })
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("uses a larger delete action in the queue history work column", () => {
    render(
      <QueueTable
        rows={[{ ...baseRow, status: "approved" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        canDeleteReviewHistory
        onDeleteReviewHistory={() => undefined}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );

    const deleteButton = screen.getByRole("button", {
      name: "심의 이력 삭제: 최고 연 5.0% 적금 홍보물 심의"
    });
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const deleteButtonBlock =
      css.match(/\.queue-row-delete-button[\s\S]*?\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";

    expect(deleteButton).toHaveClass("queue-row-delete-button");
    expect(deleteButton.querySelector("svg")).toHaveAttribute("width", "20");
    expect(deleteButtonBlock).toContain("width: 36px");
    expect(deleteButtonBlock).toContain("height: 36px");
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
