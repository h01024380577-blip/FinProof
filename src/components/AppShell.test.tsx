import { render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { RoleProvider } from "./RoleContext";
import { AppShell } from "./AppShell";

let currentPathname = "/reviews";
let currentSearchParams = new URLSearchParams();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => currentSearchParams,
  useRouter: () => ({ replace })
}));

describe("AppShell", () => {
  afterEach(() => {
    currentPathname = "/reviews";
    currentSearchParams = new URLSearchParams();
    replace.mockClear();
  });

  it("renders the compliance workbench shell", () => {
    render(
      <AppShell>
        <main>Review List Content</main>
      </AppShell>
    );

    expect(screen.queryByRole("link", { name: /Dashboard/ })).not.toBeInTheDocument();
    expect(screen.getByText("FinProof")).toBeInTheDocument();
    expect(screen.queryByText("JB금융그룹 / 광주은행 / 소비자보호부")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "FinProof home" }).querySelector(".brand__mark")
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: /심의 큐/ })).toHaveAttribute("href", "/reviews");
    expect(screen.queryByRole("link", { name: /신규 요청/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /심의 이력/ })).toHaveAttribute(
      "href",
      "/reviews?scope=history"
    );
    expect(screen.getByRole("link", { name: /지식문서 등록/ })).toHaveAttribute(
      "href",
      "/knowledge-documents"
    );
    expect(screen.queryByRole("link", { name: /Compliance workbench/ })).not.toBeInTheDocument();
    expect(screen.getByText("FinProof Agent")).toBeInTheDocument();
    expect(screen.getAllByText("심의 큐").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "알림" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사용자 메뉴" })).toBeInTheDocument();
    expect(screen.getByText("Review List Content")).toBeInTheDocument();
    expect(screen.getByText("현재 역할: 심의자")).toBeInTheDocument();
  });

  it("moves the active sidebar state to review history when scope is history", () => {
    currentSearchParams = new URLSearchParams("scope=history");

    render(
      <AppShell>
        <main>Review History Content</main>
      </AppShell>
    );

    expect(screen.getByRole("link", { name: /심의 큐/ })).toHaveAttribute("data-active", "false");
    expect(screen.getByRole("link", { name: /심의 이력/ })).toHaveAttribute("data-active", "true");
  });

  it("shows reviewer navigation without the new request item", () => {
    render(
      <AppShell>
        <main>Review List Content</main>
      </AppShell>
    );

    const primaryNav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(primaryNav)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["심의 큐", "심의 이력", "지식문서 등록"]);
  });

  it("shows only the new request navigation for requesters and redirects review pages", async () => {
    render(
      <RoleProvider initialRole="requester">
        <AppShell>
          <main>Review List Content</main>
        </AppShell>
      </RoleProvider>
    );

    const primaryNav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(primaryNav)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["신규 요청"]);
    expect(screen.getByRole("link", { name: "FinProof home" })).toHaveAttribute(
      "href",
      "/reviews/new"
    );
    expect(screen.queryByRole("link", { name: /심의 큐/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /심의 이력/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /지식문서 등록/ })).not.toBeInTheDocument();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reviews/new"));
  });

  it("uses requester-oriented breadcrumbs on the new request page", () => {
    currentPathname = "/reviews/new";

    render(
      <RoleProvider initialRole="requester">
        <AppShell>
          <main>New Request Content</main>
        </AppShell>
      </RoleProvider>
    );

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("신규 요청")).toBeInTheDocument();
    expect(within(breadcrumb).getByText("신규 심의 요청")).toBeInTheDocument();
    expect(within(breadcrumb).queryByText("심의 큐")).not.toBeInTheDocument();
  });

  it("redirects reviewers away from the requester-only new request page", async () => {
    currentPathname = "/reviews/new";

    render(
      <AppShell>
        <main>New Request Content</main>
      </AppShell>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reviews"));
  });
});
