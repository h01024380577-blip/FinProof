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
        statusLabel="검토 중"
        riskLabel="위험"
        productLabel="예금/적금"
        reviewer="박심의"
        deadline="2026-06-10"
        canMutate
        selectedAction="change_request"
        isGeneratingDraft={false}
        onSelectAction={() => undefined}
        onGenerateDraft={() => undefined}
      />
    );
    expect(screen.getByText("RC-2026-001")).toBeInTheDocument();
    expect(screen.getByText("최고 연 5.0% 적금 심의")).toBeInTheDocument();
    expect(screen.getByText(/박심의/)).toBeInTheDocument();
  });

  it("fires onSelectAction when an action button is clicked", async () => {
    const onSelect = vi.fn();
    render(
      <WorkbenchHeader
        id="RC-2026-001"
        title="title"
        statusLabel="검토 중"
        riskLabel="위험"
        productLabel="예금/적금"
        reviewer="박심의"
        deadline="2026-06-10"
        canMutate
        selectedAction="change_request"
        isGeneratingDraft={false}
        onSelectAction={onSelect}
        onGenerateDraft={() => undefined}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "반려" }));
    expect(onSelect).toHaveBeenCalledWith("reject");
  });
});
