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

export type UploadScanFile = {
  reviewCaseId: string;
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  body: Uint8Array;
};

export type UploadScanResult = {
  status: "clean" | "infected";
  scanner: string;
  signature?: string;
  message?: string;
};

export type UploadScanner = {
  scanReviewFile(input: UploadScanFile): Promise<UploadScanResult>;
};

export class UnsafeUploadError extends Error {
  constructor({
    fileName,
    scanner,
    signature
  }: {
    fileName: string;
    scanner: string;
    signature?: string;
  }) {
    super(
      `Uploaded file ${fileName} was rejected by ${scanner}${signature ? `: ${signature}` : ""}`
    );
    this.name = "UnsafeUploadError";
  }
}

function envValue(env: Env, key: string): string | undefined {
  const value = env[key];

  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function parseScanResult(body: unknown): UploadScanResult {
  if (!body || typeof body !== "object" || !("status" in body)) {
    throw new Error("Upload scanner response must include status");
  }

  const response = body as Record<string, unknown>;

  if (response.status !== "clean" && response.status !== "infected") {
    throw new Error("Upload scanner status must be clean or infected");
  }

  return {
    status: response.status,
    scanner: typeof response.scanner === "string" ? response.scanner : "http-upload-scanner",
    signature: typeof response.signature === "string" ? response.signature : undefined,
    message: typeof response.message === "string" ? response.message : undefined
  };
}

export function createDeterministicUploadScanner(): UploadScanner {
  return {
    async scanReviewFile() {
      return {
        status: "clean",
        scanner: "deterministic"
      };
    }
  };
}

export function createHttpUploadScanner({
  endpoint,
  apiKey,
  fetchImpl = fetch
}: {
  endpoint: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
}): UploadScanner {
  return {
    async scanReviewFile(input) {
      const formData = new FormData();
      formData.set("reviewCaseId", input.reviewCaseId);
      formData.set("fileId", input.fileId);
      formData.set("fileName", input.fileName);
      formData.set("sizeBytes", String(input.sizeBytes));
      formData.set(
        "file",
        new Blob([input.body as BlobPart], { type: input.contentType }),
        input.fileName
      );

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
        body: formData
      });

      if (!response.ok) {
        throw new Error(
          `Upload scanner request failed: ${response.status ?? "unknown"} ${
            response.statusText ?? ""
          }`.trim()
        );
      }

      const result = parseScanResult(await response.json());

      if (result.status === "infected") {
        throw new UnsafeUploadError({
          fileName: input.fileName,
          scanner: result.scanner,
          signature: result.signature ?? result.message
        });
      }

      return result;
    }
  };
}

export function getUploadScanner(env: Env = process.env): UploadScanner {
  const provider = envValue(env, "FINPROOF_UPLOAD_SCAN_PROVIDER") ?? "deterministic";

  if (provider === "deterministic") {
    return createDeterministicUploadScanner();
  }

  if (provider === "http") {
    const endpoint = envValue(env, "FINPROOF_UPLOAD_SCAN_ENDPOINT");

    if (!endpoint) {
      throw new Error("FINPROOF_UPLOAD_SCAN_ENDPOINT is required when upload scanning uses HTTP");
    }

    return createHttpUploadScanner({
      endpoint,
      apiKey: envValue(env, "FINPROOF_UPLOAD_SCAN_API_KEY")
    });
  }

  throw new Error(`Unsupported FINPROOF_UPLOAD_SCAN_PROVIDER: ${provider}`);
}
