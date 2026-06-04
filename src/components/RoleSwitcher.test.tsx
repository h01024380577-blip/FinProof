import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleProvider, useRole } from "./RoleContext";
import { RoleSwitcher } from "./RoleSwitcher";

function HeaderProbe() {
  const { activeRole, apiHeaders, currentUser, isAuthenticated, setAuthToken } = useRole();
  const headers = apiHeaders({ "content-type": "application/json" });

  return (
    <section aria-label="session">
      <output aria-label="active-role">{activeRole}</output>
      <output aria-label="authenticated">{String(isAuthenticated)}</output>
      <output aria-label="current-user">{currentUser?.name ?? "none"}</output>
      <output aria-label="headers">{JSON.stringify(headers)}</output>
      <button type="button" onClick={() => setAuthToken("reviewer.jwt")}>
        토큰 설정
      </button>
    </section>
  );
}

describe("RoleSwitcher", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("logs in as a requester without requiring a security code", async () => {
    const user = userEvent.setup();
    render(
      <RoleProvider initialRole="reviewer">
        <RoleSwitcher />
        <HeaderProbe />
      </RoleProvider>
    );

    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
    expect(screen.getByLabelText("active-role")).toHaveTextContent("reviewer");

    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.click(screen.getByRole("radio", { name: "요청자" }));
    await user.type(screen.getByLabelText("이름"), "홍길동");

    expect(screen.queryByLabelText("심의자 보안코드")).not.toBeInTheDocument();
    expect(screen.getByLabelText("요청자 코드")).toBeInTheDocument();
    expect(screen.getByLabelText("요청자 코드")).toHaveAttribute("placeholder", "예: guest");

    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.getByRole("alert")).toHaveTextContent("요청자 코드를 입력해 주세요.");
    expect(screen.getByLabelText("active-role")).toHaveTextContent("reviewer");

    await user.type(screen.getByLabelText("요청자 코드"), "kmu-marketing");
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.getByRole("button", { name: "홍길동 요청자" })).toBeInTheDocument();
    expect(screen.getByLabelText("active-role")).toHaveTextContent("requester");
    expect(screen.getByLabelText("authenticated")).toHaveTextContent("true");
    expect(screen.getByLabelText("current-user")).toHaveTextContent("홍길동");
    expect(screen.getByLabelText("headers")).toHaveTextContent(
      '"x-finproof-user-id":"user-requester-kmu-marketing"'
    );
    expect(screen.queryByRole("radio", { name: "요청자" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "심의자" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("finproof.demoSession")).toContain("홍길동");
    expect(window.localStorage.getItem("finproof.demoSession")).toContain(
      "user-requester-kmu-marketing"
    );
    expect(window.localStorage.getItem("finproof.demoSession")).toContain("kmu-marketing");
  });

  it("keeps the same requester identity when the display name changes but the requester code matches", async () => {
    const user = userEvent.setup();
    render(
      <RoleProvider initialRole="reviewer">
        <RoleSwitcher />
        <HeaderProbe />
      </RoleProvider>
    );

    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.click(screen.getByRole("radio", { name: "요청자" }));
    await user.type(screen.getByLabelText("이름"), "홍길동");
    await user.type(screen.getByLabelText("요청자 코드"), "kmu-marketing");
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.getByLabelText("headers")).toHaveTextContent(
      '"x-finproof-user-id":"user-requester-kmu-marketing"'
    );

    await user.click(screen.getByRole("button", { name: "홍길동 요청자" }));
    await user.click(screen.getByRole("menuitem", { name: "로그아웃" }));
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.click(screen.getByRole("radio", { name: "요청자" }));
    await user.type(screen.getByLabelText("이름"), "김지현");
    await user.type(screen.getByLabelText("요청자 코드"), "kmu-marketing");
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.getByRole("button", { name: "김지현 요청자" })).toBeInTheDocument();
    expect(screen.getByLabelText("headers")).toHaveTextContent(
      '"x-finproof-user-id":"user-requester-kmu-marketing"'
    );
    expect(screen.getByLabelText("headers")).toHaveTextContent(
      '"x-finproof-user-name":"%EA%B9%80%EC%A7%80%ED%98%84"'
    );
  });

  it("requires admin as the reviewer security code", async () => {
    const user = userEvent.setup();
    render(
      <RoleProvider initialRole="requester">
        <RoleSwitcher />
        <HeaderProbe />
      </RoleProvider>
    );

    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.click(screen.getByRole("radio", { name: "심의자" }));
    await user.type(screen.getByLabelText("이름"), "박민준");

    expect(screen.getByLabelText("심의자 보안코드")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.getByRole("alert")).toHaveTextContent("심의자 보안코드를 입력해 주세요.");
    expect(screen.getByLabelText("active-role")).toHaveTextContent("requester");

    await user.type(screen.getByLabelText("심의자 보안코드"), "wrong-code");
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.getByRole("alert")).toHaveTextContent("심의자 보안코드를 확인해 주세요.");
    expect(screen.getByLabelText("active-role")).toHaveTextContent("requester");

    await user.clear(screen.getByLabelText("심의자 보안코드"));
    await user.type(screen.getByLabelText("심의자 보안코드"), "admin");
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.getByRole("button", { name: "박민준 심의자" })).toBeInTheDocument();
    expect(screen.getByLabelText("active-role")).toHaveTextContent("reviewer");
  });

  it("shows the profile menu after login and logs out to the fallback role", async () => {
    const user = userEvent.setup();
    render(
      <RoleProvider initialRole="requester">
        <RoleSwitcher />
        <HeaderProbe />
      </RoleProvider>
    );

    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.click(screen.getByRole("radio", { name: "심의자" }));
    await user.type(screen.getByLabelText("이름"), "김심의");
    await user.type(screen.getByLabelText("심의자 보안코드"), "admin");
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    await user.click(screen.getByRole("button", { name: "김심의 심의자" }));

    const profileMenu = screen.getByRole("menu");
    expect(profileMenu).toBeInTheDocument();
    expect(within(profileMenu).getByText("김심의")).toBeInTheDocument();
    expect(within(profileMenu).getByText("심의자")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "로그아웃" }));

    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
    expect(screen.getByLabelText("active-role")).toHaveTextContent("requester");
    expect(screen.getByLabelText("authenticated")).toHaveTextContent("false");
    expect(screen.getByLabelText("current-user")).toHaveTextContent("none");
    expect(window.localStorage.getItem("finproof.demoSession")).toBeNull();
  });

  it("builds API headers from the persisted demo session and auth token", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "finproof.demoSession",
      JSON.stringify({
        currentUser: {
          name: "Existing Reviewer",
          role: "reviewer",
          userId: "demo-reviewer-existing"
        }
      })
    );

    render(
      <RoleProvider initialRole="requester">
        <RoleSwitcher />
        <HeaderProbe />
      </RoleProvider>
    );

    expect(
      await screen.findByRole("button", { name: "Existing Reviewer 심의자" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("headers")).toHaveTextContent('"x-finproof-role":"reviewer"');
    expect(screen.getByLabelText("headers")).toHaveTextContent(
      '"x-finproof-user-id":"user-reviewer-demo"'
    );
    expect(screen.getByLabelText("headers")).toHaveTextContent(
      '"x-finproof-user-name":"Existing%20Reviewer"'
    );
    expect(screen.getByLabelText("headers")).toHaveTextContent('"content-type":"application/json"');
    expect(screen.getByLabelText("headers")).not.toHaveTextContent("authorization");

    await user.click(screen.getByRole("button", { name: "토큰 설정" }));

    expect(screen.getByLabelText("headers")).toHaveTextContent(
      '"authorization":"Bearer reviewer.jwt"'
    );
    expect(window.localStorage.getItem("finproof.authToken")).toBe("reviewer.jwt");
  });
});
