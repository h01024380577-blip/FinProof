import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueSelectionModal } from "./IssueSelectionModal";
import type { ReviewIssue } from "@/domain/types";

function makeIssue(
  overrides: Partial<ReviewIssue> & Pick<ReviewIssue, "id" | "title">
): ReviewIssue {
  return {
    issueType: "claim",
    riskLevel: "high",
    targetText: "대상 문구",
    targetBbox: [0, 0, 0, 0],
    sourceAgents: [],
    suggestedAction: "change_request",
    status: "open",
    description: "설명",
    suggestedCopy: "제안",
    evidence: [],
    ...overrides
  };
}

const issues: ReviewIssue[] = [
  makeIssue({ id: "a", title: "이슈 A", riskLevel: "high" }),
  makeIssue({ id: "b", title: "이슈 B", riskLevel: "caution" }),
  makeIssue({ id: "c", title: "이슈 C", riskLevel: "info" })
];

describe("IssueSelectionModal", () => {
  it("selects all issues by default and confirms with every id", async () => {
    const onConfirm = vi.fn();
    render(
      <IssueSelectionModal
        issues={issues}
        onConfirm={onConfirm}
        onClose={() => undefined}
        isGenerating={false}
      />
    );

    expect(screen.getByText("3개 선택됨")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "선택 이슈로 초안 생성" }));

    expect(onConfirm).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("confirms only the remaining issues after deselecting one", async () => {
    const onConfirm = vi.fn();
    render(
      <IssueSelectionModal
        issues={issues}
        onConfirm={onConfirm}
        onClose={() => undefined}
        isGenerating={false}
      />
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "이슈 B 선택" }));
    await userEvent.click(screen.getByRole("button", { name: "선택 이슈로 초안 생성" }));

    expect(onConfirm).toHaveBeenCalledWith(["a", "c"]);
  });

  it("disables the confirm button when nothing is selected", async () => {
    const onConfirm = vi.fn();
    render(
      <IssueSelectionModal
        issues={issues}
        onConfirm={onConfirm}
        onClose={() => undefined}
        isGenerating={false}
      />
    );

    // "전체 선택됨" 상태이므로 "전체 해제" 버튼이 보인다.
    await userEvent.click(screen.getByRole("button", { name: "전체 해제" }));

    expect(screen.getByText("0개 선택됨")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "선택 이슈로 초안 생성" });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("filters the list by risk chip without losing prior selections", async () => {
    const onConfirm = vi.fn();
    render(
      <IssueSelectionModal
        issues={issues}
        onConfirm={onConfirm}
        onClose={() => undefined}
        isGenerating={false}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "위험" }));
    expect(screen.getByText("이슈 A")).toBeInTheDocument();
    expect(screen.queryByText("이슈 B")).not.toBeInTheDocument();

    // 필터링해도 숨겨진 이슈의 선택 상태는 유지되어 전체가 확정된다.
    await userEvent.click(screen.getByRole("button", { name: "선택 이슈로 초안 생성" }));
    expect(onConfirm).toHaveBeenCalledWith(["a", "b", "c"]);
  });
});
