// @vitest-environment node

import { callOcrService, extractViaOcrService, isOcrServiceEnabled } from "./ocr-service-client";

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

  it("treats `http` as the canonical ON value and `python_service` as a backward-compatible alias", async () => {
    expect(isOcrServiceEnabled({ FINPROOF_OCR_PROVIDER: "http" })).toBe(true);
    expect(isOcrServiceEnabled({ FINPROOF_OCR_PROVIDER: "python_service" })).toBe(true);
    // Legacy JSON-batch selector and any other value stay OFF for this client.
    expect(isOcrServiceEnabled({ FINPROOF_OCR_PROVIDER: "http_json" })).toBe(false);
    expect(isOcrServiceEnabled({ FINPROOF_OCR_PROVIDER: "deterministic" })).toBe(false);
  });

  it("callOcrService bypasses the enable-gate and calls the endpoint directly (hybrid path)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ text: "표 보존 본문", confidence: 0.95, provider: "pdfplumber" })
    );
    // No FINPROOF_OCR_PROVIDER at all — the low-level call must still fire.
    const result = await callOcrService(
      input,
      { endpoint: "http://localhost:8000/", timeoutMs: 5000 },
      fetchImpl
    );

    expect(result).toEqual({ text: "표 보존 본문", confidence: 0.95, provider: "pdfplumber" });
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:8000/extract", expect.anything());
  });

  it("callOcrService returns null on empty text so the caller falls back", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ text: "   ", confidence: 0.0, provider: "none" })
    );
    const result = await callOcrService(input, { endpoint: "http://localhost:8000" }, fetchImpl);

    expect(result).toBeNull();
  });

  it("calls the service when enabled via the canonical `http` value", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ text: "추출된 본문", confidence: 0.91, provider: "pdfplumber" })
    );
    const result = await extractViaOcrService(
      input,
      { FINPROOF_OCR_PROVIDER: "http", FINPROOF_OCR_ENDPOINT: "http://localhost:8000" },
      fetchImpl
    );

    expect(result).toEqual({ text: "추출된 본문", confidence: 0.91, provider: "pdfplumber" });
    expect(fetchImpl).toHaveBeenCalledOnce();
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
