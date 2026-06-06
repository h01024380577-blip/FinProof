import { render, screen } from "@testing-library/react";
import { IntakeClassificationPanel } from "./IntakeClassificationPanel";
import { IntakeRequiredMaterialsPanel } from "./IntakeRequiredMaterialsPanel";

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

  it("labels percentages as classification confidence, not OCR confidence", () => {
    render(
      <IntakeClassificationPanel
        files={[
          {
            id: "file-1",
            name: "poster-only.png",
            fileType: "promotional_creative",
            classificationConfidence: 0.97,
            parseStatus: "pending"
          }
        ]}
      />
    );

    expect(screen.getByText("분류 신뢰도")).toBeInTheDocument();
    expect(screen.getByText("97%")).toBeInTheDocument();
  });

  it("shows missing-material rows with a concrete missing type reason", () => {
    render(
      <IntakeRequiredMaterialsPanel
        rows={[{ label: "금리표", fileType: "rate_table", status: "missing" }]}
        extraMissingMaterials={[]}
      />
    );

    expect(screen.getByText("보완 필요")).toBeInTheDocument();
    expect(screen.getByText("자료 유형 누락")).toBeInTheDocument();
  });
});
