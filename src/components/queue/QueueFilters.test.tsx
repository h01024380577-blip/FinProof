import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueueFilters, type QueueFilterState } from "./QueueFilters";

const state: QueueFilterState = {
  search: "",
  status: "all",
  risk: "all",
  product: "all"
};

describe("QueueFilters", () => {
  it("renders search, status, risk, product filters", () => {
    render(<QueueFilters state={state} onChange={() => undefined} onReset={() => undefined} />);
    expect(screen.getByPlaceholderText(/검색/)).toBeInTheDocument();
    expect(screen.getByLabelText(/상태/)).toBeInTheDocument();
    expect(screen.getByLabelText(/위험도/)).toBeInTheDocument();
    expect(screen.getByLabelText(/상품군/)).toBeInTheDocument();
  });

  it("fires onChange when a select value changes", async () => {
    const onChange = vi.fn();
    render(<QueueFilters state={state} onChange={onChange} onReset={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText(/상태/), "analysis_waiting");
    expect(onChange).toHaveBeenCalledWith({ ...state, status: "analysis_waiting" });
  });

  it("uses all as the default history status filter", () => {
    render(
      <QueueFilters
        state={state}
        mode="history"
        onChange={() => undefined}
        onReset={() => undefined}
      />
    );

    const statusFilter = screen.getByLabelText(/상태/);
    expect(statusFilter).toHaveValue("all");
    expect(statusFilter).toHaveDisplayValue("전체");
  });
});
