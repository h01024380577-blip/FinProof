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
    expect(screen.getByLabelText("headers")).toHaveTextContent("reviewer");

    await user.click(screen.getByRole("button", { name: "관리자" }));

    expect(screen.getByRole("button", { name: "관리자" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("현재 역할: 관리자")).toBeInTheDocument();
    expect(screen.getByLabelText("headers")).toHaveTextContent("compliance_admin");
  });
});
