import type { ReviewFile } from "./types";

export type UploadFileDescriptor = {
  name: string;
  type: string;
  size: number;
};

export type UploadPolicyValidationResult = {
  ok: boolean;
  errors: string[];
};

const bytesPerMb = 1024 * 1024;
const allowedUploadExtensions = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "txt",
  "docx",
  "xlsx",
  "csv",
  "html",
  "zip"
] as const;
type AllowedExtension = (typeof allowedUploadExtensions)[number];

export const uploadPolicy = {
  maxFiles: 10,
  maxFileSizeBytes: 25 * bytesPerMb,
  maxArchiveSizeBytes: 100 * bytesPerMb,
  allowedExtensions: allowedUploadExtensions
} as const;

export const uploadAcceptAttribute = uploadPolicy.allowedExtensions
  .map((extension) => `.${extension}`)
  .join(",");

const acceptedMimeTypesByExtension: Record<AllowedExtension, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  txt: ["text/plain"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  csv: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
  html: ["text/html"],
  zip: ["application/zip", "application/x-zip-compressed"]
};

function getExtension(fileName: string): AllowedExtension | undefined {
  const extension = normalizeUploadFileName(fileName).toLowerCase().split(".").pop() ?? "";

  return uploadPolicy.allowedExtensions.includes(extension as AllowedExtension)
    ? (extension as AllowedExtension)
    : undefined;
}

function isKnownExtension(fileName: string): boolean {
  return getExtension(fileName) !== undefined;
}

function normalizeMimeType(type: string): string {
  return type.toLowerCase().split(";")[0].trim();
}

function isAcceptedMimeType(fileName: string, type: string): boolean {
  const extension = getExtension(fileName);

  if (!extension) {
    return false;
  }

  const normalizedType = normalizeMimeType(type);

  return (
    normalizedType.length === 0 || acceptedMimeTypesByExtension[extension].includes(normalizedType)
  );
}

function isArchive(fileName: string): boolean {
  return getExtension(fileName) === "zip";
}

function sizeLimitFor(fileName: string): number {
  return isArchive(fileName) ? uploadPolicy.maxArchiveSizeBytes : uploadPolicy.maxFileSizeBytes;
}

function sizeLimitLabelFor(fileName: string): string {
  return isArchive(fileName) ? "100MB" : "25MB";
}

export function validateUploadedFiles(files: UploadFileDescriptor[]): UploadPolicyValidationResult {
  const errors: string[] = [];

  if (files.length > uploadPolicy.maxFiles) {
    errors.push(`최대 ${uploadPolicy.maxFiles}개 파일까지 업로드할 수 있습니다.`);
  }

  for (const file of files) {
    if (!isKnownExtension(file.name) || !isAcceptedMimeType(file.name, file.type)) {
      errors.push(`지원하지 않는 파일 형식입니다: ${file.name}`);
      continue;
    }

    if (file.size > sizeLimitFor(file.name)) {
      errors.push(`${file.name}은 ${sizeLimitLabelFor(file.name)} 이하로 업로드해 주세요.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export type FileClassification = {
  fileType: ReviewFile["fileType"];
  confidence: number;
};

export function normalizeUploadFileName(fileName: string): string {
  return fileName.normalize("NFC");
}

function classificationFileName(fileName: string): string {
  const normalizedPath = normalizeUploadFileName(fileName).replaceAll("\\", "/");

  return normalizedPath.split("/").filter(Boolean).pop() ?? normalizedPath;
}

export function shouldIgnoreArchiveEntry(entryName: string): boolean {
  const normalizedPath = normalizeUploadFileName(entryName).replaceAll("\\", "/");
  const parts = normalizedPath.split("/");

  return (
    normalizedPath.startsWith("__MACOSX/") ||
    parts.some((part) => part === "" || part === ".DS_Store" || part.startsWith("._"))
  );
}

export function classifyUploadFileWithConfidence(file: UploadFileDescriptor): FileClassification {
  const normalizedName = classificationFileName(file.name).toLowerCase();
  const contentType = file.type;

  if (isArchive(normalizedName)) {
    return { fileType: "package_archive", confidence: 0.99 };
  }

  if (
    normalizedName.includes("poster") ||
    normalizedName.includes("banner") ||
    normalizedName.includes("creative") ||
    normalizedName.includes("ad.") ||
    normalizedName.includes("광고") ||
    normalizedName.includes("홍보물") ||
    normalizedName.includes("시안")
  ) {
    return { fileType: "promotional_creative", confidence: 0.87 };
  }

  if (normalizedName.includes("terms") || normalizedName.includes("약관")) {
    return { fileType: "terms", confidence: 0.92 };
  }

  if (normalizedName.includes("checklist") || normalizedName.includes("체크리스트")) {
    return { fileType: "checklist", confidence: 0.91 };
  }

  if (/(^|[^a-z0-9])rate([^a-z0-9]|$)/.test(normalizedName) || normalizedName.includes("금리")) {
    return { fileType: "rate_table", confidence: 0.91 };
  }

  if (normalizedName.endsWith(".xlsx") || normalizedName.endsWith(".csv")) {
    return { fileType: "rate_table", confidence: 0.78 };
  }

  if (
    normalizedName.includes("product") ||
    normalizedName.includes("description") ||
    normalizedName.includes("상품")
  ) {
    return { fileType: "product_description", confidence: 0.85 };
  }

  if (
    normalizedName.includes("copy") ||
    normalizedName.includes("draft") ||
    normalizedName.includes("카피")
  ) {
    return { fileType: "copy_draft", confidence: 0.85 };
  }

  if (normalizedName.includes("url")) {
    return { fileType: "url_list", confidence: 0.78 };
  }

  // A generic image is usually the ad creative only after material keywords fail.
  if (contentType.startsWith("image/")) {
    return { fileType: "promotional_creative", confidence: 0.97 };
  }

  return { fileType: "misc", confidence: 0.52 };
}

export function classifyUploadFile(file: UploadFileDescriptor): ReviewFile["fileType"] {
  return classifyUploadFileWithConfidence(file).fileType;
}

export function formatUploadPolicySummary(): string {
  return "PDF, PNG, JPG/JPEG, TXT, DOCX, XLSX, CSV, HTML, ZIP · 최대 10개 · 일반 파일 25MB, ZIP 100MB 이하";
}
