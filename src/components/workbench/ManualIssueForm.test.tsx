import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ManualIssueForm } from "./ManualIssueForm";

describe("ManualIssueForm", () => {
  it("requires a title before submitting", async () => {
    const onSubmit = vi.fn();
    render(
      <ManualIssueForm onSubmit={onSubmit} onClose={() => undefined} isSubmitting={false} />
    );

    await userEvent.click(screen.getByRole("button", { name: "이슈 추가" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("제목을 입력해 주세요.")).toBeInTheDocument();
  });

  it("submits the trimmed manual issue payload with selected risk and action", async () => {
    const onSubmit = vi.fn();
    render(
      <ManualIssueForm onSubmit={onSubmit} onClose={() => undefined} isSubmitting={false} />
    );

    await userEvent.type(screen.getByLabelText("이슈 제목"), "  과장 광고 표현  ");
    await userEvent.selectOptions(screen.getByLabelText("이슈 위험도"), "high");
    await userEvent.selectOptions(screen.getByLabelText("제안 조치"), "reject");
    await userEvent.type(screen.getByLabelText("지적 텍스트"), "누구나 즉시 승인");
    await userEvent.type(screen.getByLabelText("이슈 설명"), "근거 없는 단정 표현");
    await userEvent.click(screen.getByRole("button", { name: "이슈 추가" }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: "과장 광고 표현",
      riskLevel: "high",
      suggestedAction: "reject",
      targetText: "누구나 즉시 승인",
      description: "근거 없는 단정 표현"
    });
  });

  it("closes from the cancel button", async () => {
    const onClose = vi.fn();
    render(
      <ManualIssueForm onSubmit={() => undefined} onClose={onClose} isSubmitting={false} />
    );

    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
