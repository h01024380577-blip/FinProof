import {
  classifyUploadFile,
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

  it("summarizes the demo upload guardrails for the intake UI", () => {
    expect(formatUploadPolicySummary()).toBe(
      "PDF, PNG, JPG/JPEG, TXT, DOCX, XLSX, CSV, HTML, ZIP · 최대 10개 · 일반 파일 25MB, ZIP 100MB 이하"
    );
  });
});
