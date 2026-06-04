import { render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { RoleProvider } from "./RoleContext";
import { AppShell } from "./AppShell";

vi.mock("./NotificationCenter", () => ({
  NotificationCenter: () => (
    <button className="topbar__icon-button" type="button" aria-label="알림">
      알림
    </button>
  )
}));

let currentPathname = "/reviews";
let currentSearchParams = new URLSearchParams();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => currentSearchParams,
  useRouter: () => ({ replace })
}));

function seedDemoSession(
  role: "requester" | "reviewer" | "compliance_admin" = "reviewer",
  name = role === "requester" ? "김서연" : "준법심의자 박민준"
) {
  window.localStorage.setItem(
    "finproof.demoSession",
    JSON.stringify({
      currentUser: {
        name,
        role,
        userId: `demo-${role}`
      }
    })
  );
}

function renderShell(children: React.ReactNode = <main>Review List Content</main>) {
  return render(
    <RoleProvider>
      <AppShell>{children}</AppShell>
    </RoleProvider>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    currentPathname = "/reviews";
    currentSearchParams = new URLSearchParams();
    replace.mockClear();
    window.localStorage.clear();
  });

  it("renders the compliance workbench shell", async () => {
    seedDemoSession("reviewer");
    renderShell();

    expect(
      await screen.findByRole("button", { name: "준법심의자 박민준 심의자" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Dashboard/ })).not.toBeInTheDocument();
    expect(screen.getByText("FinProof")).toBeInTheDocument();
    expect(screen.queryByText("JB금융그룹 / 광주은행 / 소비자보호부")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "FinProof home" }).querySelector(".brand__mark")
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: /심의 대기 목록/ })).toHaveAttribute(
      "href",
      "/reviews"
    );
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
    expect(screen.getAllByText("심의 대기 목록").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "알림" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "사용자 메뉴" })).not.toBeInTheDocument();
    expect(screen.getByText("Review List Content")).toBeInTheDocument();
  });

  it("requires login before showing app navigation and content", () => {
    renderShell();

    expect(screen.queryByRole("link", { name: /심의 대기 목록/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Review List Content")).not.toBeInTheDocument();
    expect(screen.getByText("로그인 후 FinProof Agent를 이용해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
  });

  it("moves the active sidebar state to review history when scope is history", async () => {
    seedDemoSession("reviewer");
    currentSearchParams = new URLSearchParams("scope=history");

    renderShell(<main>Review History Content</main>);

    expect(await screen.findByRole("link", { name: /심의 대기 목록/ })).toHaveAttribute(
      "data-active",
      "false"
    );
    expect(screen.getByRole("link", { name: /심의 이력/ })).toHaveAttribute("data-active", "true");
  });

  it("shows reviewer navigation without the new request item", async () => {
    seedDemoSession("reviewer");
    renderShell();

    await screen.findByRole("link", { name: /심의 대기 목록/ });
    const primaryNav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(primaryNav)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["심의 대기 목록", "심의 이력", "지식문서 등록", "규제 변경"]);
  });

  it("shows requester navigation and redirects reviewer list pages to new request", async () => {
    seedDemoSession("requester");
    renderShell();

    await screen.findByRole("link", { name: /신규 요청/ });
    const primaryNav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(primaryNav)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["신규 요청", "요청 기록"]);
    expect(screen.getByRole("link", { name: "FinProof home" })).toHaveAttribute(
      "href",
      "/reviews/new"
    );
    expect(screen.getByRole("link", { name: /요청 기록/ })).toHaveAttribute(
      "href",
      "/reviews/history"
    );
    expect(screen.queryByRole("link", { name: /심의 대기 목록/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /심의 이력/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /지식문서 등록/ })).not.toBeInTheDocument();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reviews/new"));
  });

  it("marks the requester request history navigation as active on the history page", async () => {
    seedDemoSession("requester");
    currentPathname = "/reviews/history";

    renderShell(<main>Request History Content</main>);

    expect(await screen.findByRole("link", { name: /신규 요청/ })).toHaveAttribute(
      "data-active",
      "false"
    );
    expect(screen.getByRole("link", { name: /요청 기록/ })).toHaveAttribute("data-active", "true");
  });

  it("uses requester-oriented breadcrumbs on the request history page", async () => {
    seedDemoSession("requester");
    currentPathname = "/reviews/history";

    renderShell(<main>Request History Content</main>);

    await screen.findByRole("button", { name: "김서연 요청자" });
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("요청 기록")).toBeInTheDocument();
    expect(within(breadcrumb).getByText("내 요청 기록")).toBeInTheDocument();
    expect(within(breadcrumb).queryByText("심의 대기 목록")).not.toBeInTheDocument();
  });

  it("uses requester-oriented breadcrumbs on the new request page", async () => {
    seedDemoSession("requester");
    currentPathname = "/reviews/new";

    renderShell(<main>New Request Content</main>);

    await screen.findByRole("button", { name: "김서연 요청자" });
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("신규 요청")).toBeInTheDocument();
    expect(within(breadcrumb).getByText("신규 심의 요청")).toBeInTheDocument();
    expect(within(breadcrumb).queryByText("심의 대기 목록")).not.toBeInTheDocument();
  });

  it("redirects reviewers away from the requester-only new request page", async () => {
    seedDemoSession("reviewer");
    currentPathname = "/reviews/new";

    renderShell(<main>New Request Content</main>);

    await screen.findByRole("button", { name: "준법심의자 박민준 심의자" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reviews"));
  });

  it("redirects reviewers away from the requester-only request history page", async () => {
    seedDemoSession("reviewer");
    currentPathname = "/reviews/history";

    renderShell(<main>Request History Content</main>);

    await screen.findByRole("button", { name: "준법심의자 박민준 심의자" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reviews"));
  });

  it("does not treat review ids that start with history as the requester history route", async () => {
    seedDemoSession("reviewer");
    currentPathname = "/reviews/history-001";

    renderShell(<main>Review Detail Content</main>);

    await screen.findByRole("button", { name: "준법심의자 박민준 심의자" });
    expect(replace).not.toHaveBeenCalled();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("심의 대기 목록")).toBeInTheDocument();
    expect(within(breadcrumb).getByText("history-001")).toBeInTheDocument();
    expect(within(breadcrumb).queryByText("요청 기록")).not.toBeInTheDocument();
  });
});
