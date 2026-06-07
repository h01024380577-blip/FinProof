import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntakeMetaForm, type IntakeMetaState } from "./IntakeMetaForm";

const baseState: IntakeMetaState = {
  title: "",
  affiliate: "광주은행",
  requestDepartment: "디지털마케팅팀",
  productType: "deposit",
  plannedPublishDate: "2026-06-20",
  channels: { mobile_app: true, website: false, offline: false },
  requestMemo: ""
};

describe("IntakeMetaForm", () => {
  it("patches title without losing the rest of the metadata state", async () => {
    const onChange = vi.fn();

    render(<IntakeMetaForm state={baseState} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("심의 요청 제목"), "A");

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ ...baseState, title: "A" });
  });

  it("opens an arrow-aligned JB affiliate dropdown while allowing a custom affiliate", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<IntakeMetaForm state={baseState} onChange={onChange} />);

    const affiliateInput = screen.getByLabelText("계열사");
    expect(affiliateInput).toHaveAttribute("aria-autocomplete", "list");

    await user.click(screen.getByRole("button", { name: "계열사 목록 열기" }));

    const affiliateMenu = screen.getByRole("listbox", { name: "계열사 목록" });
    expect(affiliateMenu).toHaveClass("affiliate-combobox__menu--arrow-aligned");

    const affiliateOptions = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".affiliate-combobox__option")
    ).map((option) => option.textContent);

    expect(affiliateOptions).toEqual([
      "JB금융지주",
      "전북은행",
      "광주은행",
      "JB우리캐피탈",
      "JB자산운용",
      "JB인베스트먼트",
      "PPCBank",
      "JB Securities Vietnam",
      "JB Capital Myanmar",
      "JB PPAM",
      "기타"
    ]);

    await user.click(screen.getByRole("option", { name: "JB우리캐피탈" }));
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ ...baseState, affiliate: "JB우리캐피탈" });

    fireEvent.change(affiliateInput, { target: { value: "새 계열사" } });

    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ ...baseState, affiliate: "새 계열사" });
  });
});
