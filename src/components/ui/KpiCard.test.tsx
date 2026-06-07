import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KpiCard } from "./KpiCard";

describe("KpiCard", () => {
  it("renders label, value, and tone class", () => {
    render(<KpiCard label="분석 대기" value={7} tone="primary" />);
    expect(screen.getByText("분석 대기")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("group")).toHaveAttribute("data-tone", "primary");
  });

  it("renders as a button when onClick provided and fires it", async () => {
    const handler = vi.fn();
    render(<KpiCard label="위험" value={2} tone="danger" onClick={handler} />);
    await userEvent.click(screen.getByRole("button", { name: /위험/ }));
    expect(handler).toHaveBeenCalledOnce();
  });
});
