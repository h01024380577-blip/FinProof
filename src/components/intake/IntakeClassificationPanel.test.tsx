import { render, screen } from "@testing-library/react";
import { IntakeClassificationPanel } from "./IntakeClassificationPanel";

describe("IntakeClassificationPanel", () => {
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
