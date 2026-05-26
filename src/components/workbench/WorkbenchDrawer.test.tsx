import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchDrawer } from "./WorkbenchDrawer";

describe("WorkbenchDrawer", () => {
  it("toggles collapsed state", async () => {
    render(
      <WorkbenchDrawer
        chatNode={<span>chat</span>}
        draftNode={<span>draft</span>}
        filesNode={<span>files</span>}
        defaultCollapsed={false}
      />
    );
    expect(screen.getByText("chat")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "감사 로그" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /드로어 접기/ }));
    expect(screen.queryByText("chat")).not.toBeInTheDocument();
  });
});
