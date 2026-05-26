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
        statusLabel="검토 중"
        riskLabel="위험"
        productLabel="예금/적금"
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

  it("fires final decision action when an approval or rejection button is clicked", async () => {
    const onFinalize = vi.fn();
    render(
      <WorkbenchHeader
        id="RC-2026-001"
        title="title"
        reviewStatus="under_review"
        statusLabel="검토 중"
        riskLabel="위험"
        productLabel="예금/적금"
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
