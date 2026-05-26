import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/reviews"
}));

describe("AppShell", () => {
  it("renders the compliance workbench shell", () => {
    render(
      <AppShell>
        <main>Review List Content</main>
      </AppShell>
    );

    expect(screen.queryByRole("link", { name: /Dashboard/ })).not.toBeInTheDocument();
    expect(screen.getByText("FinProof")).toBeInTheDocument();
    expect(screen.getByText("JB금융그룹 / 광주은행 / 소비자보호부")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /심의 큐/ })).toHaveAttribute("href", "/reviews");
    expect(screen.getByRole("link", { name: /신규 요청/ })).toHaveAttribute("href", "/reviews/new");
    expect(screen.getByRole("link", { name: /Compliance workbench/ })).toHaveAttribute(
      "href",
      "/reviews"
    );
    expect(screen.getByText("FinProof Agent")).toBeInTheDocument();
    expect(screen.getAllByText("심의 큐").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "알림" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사용자 메뉴" })).toBeInTheDocument();
    expect(screen.getByText("Review List Content")).toBeInTheDocument();
    expect(screen.getByText("현재 역할: Reviewer")).toBeInTheDocument();
  });
});
