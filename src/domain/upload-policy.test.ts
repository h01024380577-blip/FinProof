import {
  classifyUploadFile,
  classifyUploadFileWithConfidence,
  formatUploadPolicySummary,
  validateUploadedFiles
} from "./upload-policy";

describe("upload policy", () => {
  it("accepts demo-safe document/image/table/archive formats and classifies zip as an archive package", () => {
    const result = validateUploadedFiles([
      { name: "poster.PNG", type: "image/png", size: 2048 },
      { name: "banner.jpeg", type: "image/jpeg", size: 2048 },
      { name: "review-package.zip", type: "", size: 4096 }
    ]);

    expect(result).toEqual({ ok: true, errors: [] });
    expect(classifyUploadFile({ name: "review-package.zip", type: "", size: 4096 })).toBe(
      "package_archive"
    );
  });

  it("rejects unsupported formats, too many files, and files above the demo size limit", () => {
    const tooManyFiles = Array.from({ length: 11 }, (_, index) => ({
      name: `poster-${index}.png`,
      type: "image/png",
      size: 1024
    }));

    expect(validateUploadedFiles(tooManyFiles).errors).toContain(
      "최대 10개 파일까지 업로드할 수 있습니다."
    );
    expect(
      validateUploadedFiles([{ name: "malware.exe", type: "application/octet-stream", size: 1024 }])
        .errors
    ).toContain("지원하지 않는 파일 형식입니다: malware.exe");
    expect(
      validateUploadedFiles([{ name: "fake.pdf", type: "application/octet-stream", size: 1024 }])
        .errors
    ).toContain("지원하지 않는 파일 형식입니다: fake.pdf");
    expect(
      validateUploadedFiles([
        { name: "large-poster.png", type: "image/png", size: 26 * 1024 * 1024 }
      ]).errors
    ).toContain("large-poster.png은 25MB 이하로 업로드해 주세요.");
    expect(
      validateUploadedFiles([
        { name: "large-package.zip", type: "application/zip", size: 101 * 1024 * 1024 }
      ]).errors
    ).toContain("large-package.zip은 100MB 이하로 업로드해 주세요.");
  });

  it("rejects MIME types that do not match the allowed extension", () => {
    expect(
      validateUploadedFiles([{ name: "payload.zip", type: "image/png", size: 1024 }]).errors
    ).toContain("지원하지 않는 파일 형식입니다: payload.zip");
    expect(
      validateUploadedFiles([{ name: "page.pdf", type: "text/html", size: 1024 }]).errors
    ).toContain("지원하지 않는 파일 형식입니다: page.pdf");
  });

  it("accepts common MIME variants for allowed extensions", () => {
    expect(
      validateUploadedFiles([
        { name: "photo.jpg", type: "image/jpg", size: 1024 },
        { name: "url-list.csv", type: "application/vnd.ms-excel", size: 1024 },
        { name: "copy.txt", type: "text/plain; charset=utf-8", size: 1024 }
      ])
    ).toEqual({ ok: true, errors: [] });
  });

  it("classifies checklist files before rate-table keyword matches", () => {
    expect(
      classifyUploadFile({
        name: "internal_checklist_high_rate_deposit.txt",
        type: "text/plain",
        size: 1024
      })
    ).toBe("checklist");
  });

  it("uses material filename keywords before the generic image MIME signal", () => {
    expect(
      classifyUploadFileWithConfidence({
        name: "심의패키지_v3.zip/금리안내표.png",
        type: "image/png",
        size: 1024
      })
    ).toEqual({ fileType: "rate_table", confidence: 0.91 });
    expect(
      classifyUploadFileWithConfidence({
        name: "심의패키지_v3.zip/상품설명서.png",
        type: "image/png",
        size: 1024
      })
    ).toEqual({ fileType: "product_description", confidence: 0.85 });
    expect(
      classifyUploadFileWithConfidence({
        name: "심의패키지_v3.zip/체크리스트.png",
        type: "image/png",
        size: 1024
      })
    ).toEqual({ fileType: "checklist", confidence: 0.91 });
  });

  it("ignores ZIP archive and folder path keywords when classifying material files", () => {
    expect(
      classifyUploadFileWithConfidence({
        name: "borderline_01_lowrate_compliant.zip/borderline_01_lowrate/원문카피_borderline_01.txt",
        type: "text/plain",
        size: 1024
      })
    ).toEqual({ fileType: "copy_draft", confidence: 0.85 });
    expect(
      classifyUploadFileWithConfidence({
        name: "borderline_01_lowrate_compliant.zip/borderline_01_lowrate/상품설명서_borderline_01.txt",
        type: "text/plain",
        size: 1024
      })
    ).toEqual({ fileType: "product_description", confidence: 0.85 });
  });

  it("classifies advertisement PDFs as promotional creatives from Korean filename keywords", () => {
    expect(
      classifyUploadFileWithConfidence({
        name: "대출광고.pdf",
        type: "application/pdf",
        size: 1024
      })
    ).toEqual({ fileType: "promotional_creative", confidence: 0.87 });
  });

  it("classifies decomposed Korean filenames from macOS ZIP archives", () => {
    expect(
      classifyUploadFileWithConfidence({
        name: "03_상품설명서.pdf".normalize("NFD"),
        type: "application/pdf",
        size: 1024
      })
    ).toEqual({ fileType: "product_description", confidence: 0.85 });
    expect(
      classifyUploadFileWithConfidence({
        name: "04_금리표_및_수수료.pdf".normalize("NFD"),
        type: "application/pdf",
        size: 1024
      })
    ).toEqual({ fileType: "rate_table", confidence: 0.91 });
    expect(
      classifyUploadFileWithConfidence({
        name: "06_내부_체크리스트.pdf".normalize("NFD"),
        type: "application/pdf",
        size: 1024
      })
    ).toEqual({ fileType: "checklist", confidence: 0.91 });
  });

  it("summarizes the demo upload guardrails for the intake UI", () => {
    expect(formatUploadPolicySummary()).toBe(
      "PDF, PNG, JPG/JPEG, TXT, DOCX, XLSX, CSV, HTML, ZIP · 최대 10개 · 일반 파일 25MB, ZIP 100MB 이하"
    );
  });
});
