import { render, screen } from "@testing-library/react";
import { IntakeClassificationPanel } from "./IntakeClassificationPanel";

describe("IntakeClassificationPanel", () => {
  it("renders the uploaded file list as a bounded scrollable list", () => {
    render(
      <IntakeClassificationPanel
        files={Array.from({ length: 8 }, (_, index) => ({
          id: `file-${index + 1}`,
          name: `mira-guaranteed-return-review-uploadable.zip/file-${index + 1}.txt`,
          fileType: "copy_draft",
          classificationConfidence: 0.74,
          parseStatus: "pending"
        }))}
      />
    );

    const list = screen.getByRole("list", { name: "자동 분류 파일 목록" });

    expect(list).toHaveClass("classification-list--scrollable");
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
  });

  it("marks long uploaded archive paths as wrapping filenames", () => {
    render(
      <IntakeClassificationPanel
        files={[
          {
            id: "file-1",
            name: "mira-guaranteed-return-review-uploadable.zip/product_description_mira_guaranteed_return.txt",
            fileType: "product_description",
            classificationConfidence: 0.82,
            parseStatus: "pending"
          }
        ]}
      />
    );

    expect(
      screen.getByText(
        "mira-guaranteed-return-review-uploadable.zip/product_description_mira_guaranteed_return.txt"
      )
    ).toHaveClass("classification-row__filename");
  });
});
