import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleProvider, useRole } from "./RoleContext";
import { RoleSwitcher } from "./RoleSwitcher";

function HeaderProbe() {
  const { apiHeaders } = useRole();
  const headers = apiHeaders();

  return <output aria-label="headers">{headers.authorization ?? "no-token"}</output>;
}

describe("RoleSwitcher", () => {
  it("switches the active mock user role", async () => {
    const user = userEvent.setup();
    render(<RoleSwitcher />);

    expect(screen.getByRole("button", { name: "Reviewer" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await user.click(screen.getByRole("button", { name: "Requester" }));

    expect(screen.getByRole("button", { name: "Requester" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("현재 역할: Requester")).toBeInTheDocument();
  });

  it("stores an operator JWT for production API calls", async () => {
    const user = userEvent.setup();
    render(
      <RoleProvider>
        <RoleSwitcher />
        <HeaderProbe />
      </RoleProvider>
    );

    await user.type(screen.getByLabelText("Bearer JWT"), "operator.jwt");

    expect(screen.getByLabelText("headers")).toHaveTextContent("Bearer operator.jwt");
  });
});
