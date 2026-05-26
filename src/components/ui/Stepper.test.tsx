import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "./Stepper";

describe("Stepper", () => {
  it("renders all steps with status data attributes", () => {
    render(
      <Stepper
        steps={[
          { key: "meta", label: "메타", status: "done" },
          { key: "upload", label: "업로드", status: "active" },
          { key: "check", label: "확인", status: "pending" }
        ]}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-status", "done");
    expect(items[1]).toHaveAttribute("data-status", "active");
    expect(items[2]).toHaveAttribute("data-status", "pending");
  });
});
