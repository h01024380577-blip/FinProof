import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropZone } from "./DropZone";

describe("DropZone", () => {
  it("renders helper text and shows file list with remove buttons", async () => {
    const onRemove = vi.fn();
    render(
      <DropZone
        accept=".pdf"
        files={[new File(["x"], "a.pdf", { type: "application/pdf" })]}
        helperText="파일을 끌어다 놓거나 클릭"
        onFilesSelected={() => undefined}
        onRemoveFile={onRemove}
      />
    );
    expect(screen.getByText("파일을 끌어다 놓거나 클릭")).toBeInTheDocument();
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /a.pdf 제거/ }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("fires onFilesSelected when file input changes", async () => {
    const onSelect = vi.fn();
    render(
      <DropZone
        accept=".pdf"
        files={[]}
        helperText="upload"
        onFilesSelected={onSelect}
        onRemoveFile={() => undefined}
      />
    );
    const input = screen.getByLabelText("upload", { selector: "input" }) as HTMLInputElement;
    await userEvent.upload(input, new File(["y"], "b.pdf", { type: "application/pdf" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0][0].name).toBe("b.pdf");
  });
});
