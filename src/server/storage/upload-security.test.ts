import {
  createDeterministicUploadScanner,
  createHttpUploadScanner,
  getUploadScanner,
  UnsafeUploadError
} from "./upload-security";

describe("upload security scanner", () => {
  const cleanFile = {
    reviewCaseId: "rc-upload-001",
    fileId: "file-upload-001",
    fileName: "poster.png",
    contentType: "image/png",
    sizeBytes: 3,
    body: new Uint8Array([1, 2, 3])
  };

  it("allows files in deterministic local mode", async () => {
    await expect(createDeterministicUploadScanner().scanReviewFile(cleanFile)).resolves.toEqual({
      status: "clean",
      scanner: "deterministic"
    });
  });

  it("posts uploaded bytes to the configured HTTP scanner", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "clean",
        scanner: "clamav-gateway"
      })
    });
    const scanner = createHttpUploadScanner({
      endpoint: "https://scanner.example.com/scan",
      apiKey: "scan-secret",
      fetchImpl
    });

    await expect(scanner.scanReviewFile(cleanFile)).resolves.toEqual({
      status: "clean",
      scanner: "clamav-gateway"
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://scanner.example.com/scan",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer scan-secret"
        }),
        body: expect.any(FormData)
      })
    );
  });

  it("raises a typed error when the scanner flags malware", async () => {
    const scanner = createHttpUploadScanner({
      endpoint: "https://scanner.example.com/scan",
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "infected",
          scanner: "clamav-gateway",
          signature: "EICAR-Test-File"
        })
      })
    });

    await expect(scanner.scanReviewFile(cleanFile)).rejects.toThrow(UnsafeUploadError);
  });

  it("requires a scan endpoint when HTTP scanning is enabled", () => {
    expect(() =>
      getUploadScanner({
        FINPROOF_UPLOAD_SCAN_PROVIDER: "http"
      })
    ).toThrow("FINPROOF_UPLOAD_SCAN_ENDPOINT is required");
  });
});
