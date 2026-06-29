// @vitest-environment node

import { extractViaOcrService, isOcrServiceEnabled } from "./ocr-service-client";

const input = {
  fileName: "scan.pdf",
  contentType: "application/pdf",
  body: new TextEncoder().encode("dummy")
};

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => payload
  };
}

describe("ocr-service-client", () => {
  it("is disabled (returns null) when FINPROOF_OCR_PROVIDER is unset", async () => {
    const fetchImpl = vi.fn();
    const result = await extractViaOcrService(input, {}, fetchImpl);

    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isOcrServiceEnabled({})).toBe(false);
  });

  it("returns null when enabled but endpoint is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await extractViaOcrService(
      input,
      { FINPROOF_OCR_PROVIDER: "python_service" },
      fetchImpl
    );

    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns parsed result on a successful service call", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ text: "추출된 본문", confidence: 0.95, provider: "pymupdf" })
    );
    const result = await extractViaOcrService(
      input,
      { FINPROOF_OCR_PROVIDER: "python_service", FINPROOF_OCR_ENDPOINT: "http://localhost:8000/" },
      fetchImpl
    );

    expect(result).toEqual({ text: "추출된 본문", confidence: 0.95, provider: "pymupdf" });
    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe("http://localhost:8000/extract"); // trailing slash normalized
    expect(init?.method).toBe("POST");
  });

  it("falls back (null) on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const result = await extractViaOcrService(
      input,
      { FINPROOF_OCR_PROVIDER: "python_service", FINPROOF_OCR_ENDPOINT: "http://localhost:8000" },
      fetchImpl
    );

    expect(result).toBeNull();
  });

  it("falls back (null) when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await extractViaOcrService(
      input,
      { FINPROOF_OCR_PROVIDER: "python_service", FINPROOF_OCR_ENDPOINT: "http://localhost:8000" },
      fetchImpl
    );

    expect(result).toBeNull();
  });

  it("falls back (null) when the service returns empty text", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ text: "   ", confidence: 0.0, provider: "timeout" })
    );
    const result = await extractViaOcrService(
      input,
      { FINPROOF_OCR_PROVIDER: "python_service", FINPROOF_OCR_ENDPOINT: "http://localhost:8000" },
      fetchImpl
    );

    expect(result).toBeNull();
  });
});
