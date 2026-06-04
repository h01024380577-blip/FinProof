import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchHeader } from "./WorkbenchHeader";

describe("WorkbenchHeader", () => {
  it("renders id, title, and meta", () => {
    render(
      <WorkbenchHeader
        id="RC-2026-001"
        title="최고 연 5.0% 적금 심의"
        reviewStatus="under_review"
        riskLevel="high"
        productLabel="예금/적금"
        requester="김요청"
        reviewer="박심의"
        deadline="2026-06-10"
        canMutate
        isFinalizingReview={false}
        onFinalizeReviewCase={() => undefined}
      />
    );
    expect(screen.getByText("RC-2026-001")).toBeInTheDocument();
    expect(screen.getByText("최고 연 5.0% 적금 심의")).toBeInTheDocument();
    expect(screen.getByText(/박심의/)).toBeInTheDocument();
  });

  it("renders the case summary like a reviewer queue row with live status and risk badges", () => {
    render(
      <WorkbenchHeader
        id="RC-2026-001"
        title="최고 연 5.0% 적금 심의"
        reviewStatus="analysis_complete"
        riskLevel="high"
        productLabel="예금/적금"
        requester="김요청"
        reviewer=""
        deadline="2026-06-10"
        canMutate
        isFinalizingReview={false}
        onFinalizeReviewCase={() => undefined}
      />
    );

    const row = screen.getByRole("row", { name: /최고 연 5.0% 적금 심의/ });
    expect(row).toHaveClass("workbench-summary-row");
    expect(screen.getByText("심의 ID")).toBeInTheDocument();
    expect(screen.getByText("요청 부서")).toBeInTheDocument();
    expect(screen.getByText("요청자")).toBeInTheDocument();
    expect(screen.getByText("상태")).toBeInTheDocument();
    expect(screen.getByText("위험도")).toBeInTheDocument();
    expect(screen.getByText("마감일")).toBeInTheDocument();
    expect(screen.getByText("담당자")).toBeInTheDocument();
    expect(screen.getByText("마케팅팀")).toBeInTheDocument();
    expect(screen.getByText("김요청")).toBeInTheDocument();
    expect(screen.getByText("미배정")).toBeInTheDocument();
    expect(screen.getByText("AI 분석 완료")).toHaveAttribute("data-status", "analysis_complete");
    expect(screen.getByText("위험")).toHaveAttribute("data-risk", "high");
  });

  it("fires final decision action when an approval or rejection button is clicked", async () => {
    const onFinalize = vi.fn();
    render(
      <WorkbenchHeader
        id="RC-2026-001"
        title="title"
        reviewStatus="under_review"
        riskLevel="high"
        productLabel="예금/적금"
        requester="김요청"
        reviewer="박심의"
        deadline="2026-06-10"
        canMutate
        isFinalizingReview={false}
        onFinalizeReviewCase={onFinalize}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "승인" }));
    await userEvent.click(screen.getByRole("button", { name: "반려" }));

    expect(onFinalize).toHaveBeenNthCalledWith(1, "approve");
    expect(onFinalize).toHaveBeenNthCalledWith(2, "reject");
  });
});
