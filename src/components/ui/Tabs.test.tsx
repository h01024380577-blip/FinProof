import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs } from "./Tabs";

const items = [
  { key: "a", label: "A", panel: <span>A-content</span> },
  { key: "b", label: "B", panel: <span>B-content</span> }
];

describe("Tabs", () => {
  it("renders first tab active by default and shows its panel", () => {
    render(<Tabs items={items} />);
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("A-content")).toBeInTheDocument();
  });

  it("switches active tab on click", async () => {
    render(<Tabs items={items} />);
    await userEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("B-content")).toBeInTheDocument();
  });

  it("supports controlled mode via activeKey/onChange", async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} activeKey="b" onChange={onChange} />);
    expect(screen.getByText("B-content")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "A" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });
});
