import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleProvider, useRole } from "./RoleContext";
import { RoleSwitcher } from "./RoleSwitcher";

function HeaderProbe() {
  const { apiHeaders } = useRole();
  const headers = apiHeaders();

  return <output aria-label="headers">{headers["x-finproof-role"]}</output>;
}

describe("RoleSwitcher", () => {
  it("switches the active mock user role", async () => {
    const user = userEvent.setup();
    render(<RoleSwitcher />);

    expect(screen.getByRole("button", { name: "심의자" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "요청자" }));

    expect(screen.getByRole("button", { name: "요청자" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("현재 역할: 요청자")).toBeInTheDocument();
  });

  it("changes API role headers by clicking role buttons and does not render JWT input", async () => {
    const user = userEvent.setup();
    render(
      <RoleProvider>
        <RoleSwitcher />
        <HeaderProbe />
      </RoleProvider>
    );

    expect(screen.queryByLabelText("Bearer JWT")).not.toBeInTheDocument();
    expect(screen.queryByText("JWT")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "관리자" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("headers")).toHaveTextContent("reviewer");

    await user.click(screen.getByRole("button", { name: "요청자" }));

    expect(screen.getByRole("button", { name: "요청자" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("현재 역할: 요청자")).toBeInTheDocument();
    expect(screen.getByLabelText("headers")).toHaveTextContent("requester");
  });

  it("requires a security code before switching from requester to reviewer", async () => {
    const user = userEvent.setup();
    render(
      <RoleProvider initialRole="requester">
        <RoleSwitcher />
        <HeaderProbe />
      </RoleProvider>
    );

    expect(screen.getByLabelText("headers")).toHaveTextContent("requester");

    await user.click(screen.getByRole("button", { name: "심의자" }));

    expect(screen.getByLabelText("심의자 보안코드")).toBeInTheDocument();
    expect(screen.getByText("예시 보안코드: FP-REVIEW-2026")).toBeInTheDocument();
    expect(screen.getByLabelText("headers")).toHaveTextContent("requester");

    await user.type(screen.getByLabelText("심의자 보안코드"), "WRONG-CODE");
    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(screen.getByRole("alert")).toHaveTextContent("보안코드가 일치하지 않습니다.");
    expect(screen.getByLabelText("headers")).toHaveTextContent("requester");

    await user.clear(screen.getByLabelText("심의자 보안코드"));
    await user.type(screen.getByLabelText("심의자 보안코드"), "FP-REVIEW-2026");
    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(screen.getByLabelText("headers")).toHaveTextContent("reviewer");
    expect(screen.getByText("현재 역할: 심의자")).toBeInTheDocument();
    expect(screen.queryByLabelText("심의자 보안코드")).not.toBeInTheDocument();
  });
});
