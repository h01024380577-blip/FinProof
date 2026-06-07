import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueueMetrics } from "./QueueMetrics";

describe("QueueMetrics", () => {
  const metrics = {
    analysisWaiting: 7,
    inReview: 4,
    highRisk: 2,
    dueSoon: 1
  };

  it("renders four KPI cards with values", () => {
    render(<QueueMetrics metrics={metrics} />);
    expect(screen.getByText("분석 대기")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("위험")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("invokes click handlers when KPI cards are clickable", async () => {
    const onSelectRisk = vi.fn();
    const onSelectDueSoon = vi.fn();
    render(
      <QueueMetrics
        metrics={metrics}
        onSelectHighRisk={onSelectRisk}
        onSelectDueSoon={onSelectDueSoon}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /위험/ }));
    expect(onSelectRisk).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: /마감 임박/ }));
    expect(onSelectDueSoon).toHaveBeenCalledOnce();
  });
});
