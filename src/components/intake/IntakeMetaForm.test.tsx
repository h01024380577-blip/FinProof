import { render, screen } from "@testing-library/react";
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
});
