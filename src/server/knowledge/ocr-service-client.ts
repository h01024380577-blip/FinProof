/**
 * Client for the optional Python OCR / document-preprocessing microservice
 * (see `ocr-service/`). Mirrors the existing "external provider + deterministic
 * fallback" pattern used by `rerank-provider.ts`:
 *
 *   - `FINPROOF_OCR_PROVIDER=http` turns it ON (`python_service` is kept as a
 *     backward-compatible alias). Unset => OFF, legacy behavior is preserved exactly.
 *   - `FINPROOF_OCR_ENDPOINT` is the service base URL (e.g. http://localhost:8000).
 *   - `FINPROOF_OCR_TIMEOUT_MS` bounds the call (default 30000).
 *
 * On disabled / missing-config / timeout / non-OK / empty-text, this returns
 * `null` so the caller falls back to its legacy extraction path. No new runtime
 * dependencies — uses Node's built-in fetch / FormData / Blob / AbortController.
 *
 * Phase 2 regime unification: `http` now enables BOTH the knowledge-ingestion
 * path (Phase 1) and the analysis-pipeline review-file OCR (Phase 2), which share
 * this client. `provider-config.ts` independently recognizes `http` and validates
 * `FINPROOF_OCR_ENDPOINT`; the analysis pipeline branches on `isOcrServiceEnabled`
 * directly so the multipart `/extract` client is used (not the legacy JSON-batch
 * `createHttpOcrProvider`, which is retained under the explicit `http_json` value).
 */

type Env = Record<string, string | undefined>;

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

export type OcrServiceInput = {
  fileName: string;
  contentType: string;
  body: Uint8Array;
};

export type OcrServiceResult = {
  text: string;
  confidence: number; // 0~1, aligned with ExtractedDocument.confidence (0.82 threshold)
  provider: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;

function value(env: Env, key: string): string | undefined {
  const raw = env[key];

  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function positiveNumber(env: Env, key: string, fallback: number): number {
  const raw = value(env, key);
  const parsed = raw ? Number(raw) : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isOcrServiceEnabled(env: Env = process.env): boolean {
  const provider = value(env, "FINPROOF_OCR_PROVIDER");

  // `http` is the canonical value (Phase 2 regime unification); `python_service`
  // is kept as a backward-compatible alias so existing configs keep working.
  return provider === "http" || provider === "python_service";
}

export async function extractViaOcrService(
  input: OcrServiceInput,
  env: Env = process.env,
  fetchImpl: FetchLike = fetch
): Promise<OcrServiceResult | null> {
  if (!isOcrServiceEnabled(env)) {
    return null;
  }

  const endpoint = value(env, "FINPROOF_OCR_ENDPOINT");

  if (!endpoint) {
    console.log("[OcrService] FINPROOF_OCR_ENDPOINT is not set; falling back to legacy extraction");

    return null;
  }

  const timeoutMs = positiveNumber(env, "FINPROOF_OCR_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${endpoint.replace(/\/+$/, "")}/extract`;

  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([input.body], {
        type: input.contentType || "application/octet-stream"
      }),
      input.fileName
    );
    form.append("content_type", input.contentType ?? "");

    const response = await fetchImpl(url, {
      method: "POST",
      body: form,
      signal: controller.signal
    });

    if (!response.ok) {
      console.log(
        `[OcrService] extract failed: ${response.status ?? "unknown"} ${
          response.statusText ?? ""
        }; falling back`.trim()
      );

      return null;
    }

    const parsed = parseExtractResponse(await response.json());

    if (!parsed || !parsed.text.trim()) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.log(`[OcrService] unavailable: ${errorMessage(error)}; falling back`);

    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseExtractResponse(body: unknown): OcrServiceResult | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const text = "text" in body && typeof body.text === "string" ? body.text : "";
  const confidence =
    "confidence" in body && typeof body.confidence === "number" ? body.confidence : 0;
  const provider =
    "provider" in body && typeof body.provider === "string" ? body.provider : "python_service";

  return { text, confidence, provider };
}
