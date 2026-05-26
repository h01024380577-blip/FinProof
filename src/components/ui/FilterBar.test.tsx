import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterBar, type FilterGroup } from "./FilterBar";

describe("FilterBar", () => {
  it("renders search input and groups, fires callbacks", async () => {
    const onSearch = vi.fn();
    const onChange = vi.fn();
    const groups: FilterGroup[] = [
      {
        key: "status",
        label: "상태",
        value: "all",
        options: [
          { value: "all", label: "전체" },
          { value: "open", label: "열림" }
        ]
      }
    ];
    render(
      <FilterBar
        searchValue=""
        searchPlaceholder="검색"
        onSearchChange={onSearch}
        groups={groups}
        onGroupChange={onChange}
      />
    );
    await userEvent.type(screen.getByPlaceholderText("검색"), "abc");
    expect(onSearch).toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText("상태"), "open");
    expect(onChange).toHaveBeenCalledWith("status", "open");
  });

  it("shows reset button when any group has a non-default value and search is non-empty", async () => {
    const onReset = vi.fn();
    render(
      <FilterBar
        searchValue="x"
        searchPlaceholder="검색"
        onSearchChange={() => undefined}
        groups={[
          {
            key: "status",
            label: "상태",
            value: "open",
            defaultValue: "all",
            options: [
              { value: "all", label: "전체" },
              { value: "open", label: "열림" }
            ]
          }
        ]}
        onGroupChange={() => undefined}
        onReset={onReset}
      />
    );
    const button = screen.getByRole("button", { name: "필터 초기화" });
    await userEvent.click(button);
    expect(onReset).toHaveBeenCalledOnce();
  });
});
