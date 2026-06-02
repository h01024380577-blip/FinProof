import { buildSamplePackagePreview, getRequiredMaterialRows, getSamplePackages } from "./intake";

describe("sample package intake", () => {
  it("offers the two approved Demo MVP sample packages", () => {
    expect(getSamplePackages().map((samplePackage) => samplePackage.id)).toEqual([
      "rc-demo-deposit-001",
      "rc-demo-loan-001"
    ]);
  });

  it("builds an automatic classification preview from the selected package", () => {
    const preview = buildSamplePackagePreview("rc-demo-deposit-001");

    expect(preview?.reviewCaseId).toBe("rc-demo-deposit-001");
    expect(preview?.files.map((file) => file.fileType)).toEqual([
      "promotional_creative",
      "product_description",
      "rate_table"
    ]);
    expect(preview?.missingMaterials).toEqual(["terms", "internal_checklist"]);
    expect(preview?.analysisStartHref).toBe("/reviews/rc-demo-deposit-001");
  });

  it("marks required loan materials as present or missing", () => {
    const review = buildSamplePackagePreview("rc-demo-loan-001");

    expect(review).toBeDefined();
    expect(getRequiredMaterialRows(review!)).toEqual([
      { label: "홍보물 시안", fileType: "promotional_creative", status: "present" },
      { label: "원문 카피", fileType: "copy_draft", status: "missing" },
      { label: "상품 설명서", fileType: "product_description", status: "present" },
      { label: "금리표", fileType: "rate_table", status: "missing" },
      { label: "약관/대출 조건", fileType: "terms", status: "missing" },
      { label: "내부 체크리스트", fileType: "checklist", status: "present" }
    ]);
  });

  it("requires only a promotional image for the image-only test product type", () => {
    expect(
      getRequiredMaterialRows({
        productType: "image_test",
        files: [
          {
            id: "file-test-poster",
            name: "poster.png",
            fileType: "promotional_creative",
            classificationConfidence: 0.98,
            parseStatus: "pending"
          }
        ]
      })
    ).toEqual([{ label: "홍보 이미지", fileType: "promotional_creative", status: "present" }]);
  });
});
