import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { AppShell } from "./AppShell";

let currentPathname = "/reviews";
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => currentSearchParams
}));

describe("AppShell", () => {
  afterEach(() => {
    currentPathname = "/reviews";
    currentSearchParams = new URLSearchParams();
  });

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
    expect(screen.getByRole("link", { name: /심의 이력/ })).toHaveAttribute(
      "href",
      "/reviews?scope=history"
    );
    expect(screen.queryByRole("link", { name: /감사 로그/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Compliance workbench/ })).not.toBeInTheDocument();
    expect(screen.getByText("FinProof Agent")).toBeInTheDocument();
    expect(screen.getAllByText("심의 큐").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "알림" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사용자 메뉴" })).toBeInTheDocument();
    expect(screen.getByText("Review List Content")).toBeInTheDocument();
    expect(screen.getByText("현재 역할: Reviewer")).toBeInTheDocument();
  });

  it("moves the active sidebar state to review history when scope is history", () => {
    currentSearchParams = new URLSearchParams("scope=history");

    render(
      <AppShell>
        <main>Review History Content</main>
      </AppShell>
    );

    expect(screen.getByRole("link", { name: /심의 큐/ })).toHaveAttribute("data-active", "false");
    expect(screen.getByRole("link", { name: /심의 이력/ })).toHaveAttribute(
      "data-active",
      "true"
    );
  });

  it("puts the new request navigation item first", () => {
    render(
      <AppShell>
        <main>Review List Content</main>
      </AppShell>
    );

    const primaryNav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(primaryNav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "신규 요청",
      "심의 큐",
      "심의 이력"
    ]);
  });
});
