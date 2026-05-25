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

export const uploadPolicy = {
  maxFiles: 10,
  maxFileSizeBytes: 25 * bytesPerMb,
  maxArchiveSizeBytes: 100 * bytesPerMb,
  allowedExtensions: ["pdf", "png", "jpg", "jpeg", "txt", "docx", "xlsx", "csv", "html", "zip"]
} as const;

export const uploadAcceptAttribute = uploadPolicy.allowedExtensions
  .map((extension) => `.${extension}`)
  .join(",");

const acceptedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/html",
  "application/zip",
  "application/x-zip-compressed"
]);

function getExtension(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function isKnownExtension(fileName: string): boolean {
  return uploadPolicy.allowedExtensions.includes(
    getExtension(fileName) as (typeof uploadPolicy.allowedExtensions)[number]
  );
}

function isAcceptedMimeType(type: string): boolean {
  return type.trim().length === 0 || acceptedMimeTypes.has(type);
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
    if (!isKnownExtension(file.name) || !isAcceptedMimeType(file.type)) {
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

export function classifyUploadFile(file: UploadFileDescriptor): ReviewFile["fileType"] {
  const normalizedName = file.name.toLowerCase();
  const contentType = file.type;

  if (isArchive(file.name)) {
    return "package_archive";
  }

  if (
    normalizedName.includes("poster") ||
    normalizedName.includes("banner") ||
    normalizedName.includes("creative") ||
    contentType.startsWith("image/")
  ) {
    return "promotional_creative";
  }

  if (normalizedName.includes("copy") || normalizedName.includes("draft")) {
    return "copy_draft";
  }

  if (
    normalizedName.includes("product") ||
    normalizedName.includes("description") ||
    normalizedName.includes("상품")
  ) {
    return "product_description";
  }

  if (normalizedName.includes("terms") || normalizedName.includes("약관")) {
    return "terms";
  }

  if (
    normalizedName.includes("rate") ||
    normalizedName.includes("금리") ||
    normalizedName.endsWith(".xlsx")
  ) {
    return "rate_table";
  }

  if (normalizedName.includes("checklist") || normalizedName.includes("체크리스트")) {
    return "checklist";
  }

  if (normalizedName.includes("url")) {
    return "url_list";
  }

  return "misc";
}

export function formatUploadPolicySummary(): string {
  return "PDF, PNG, JPG/JPEG, TXT, DOCX, XLSX, CSV, HTML, ZIP · 최대 10개 · 일반 파일 25MB, ZIP 100MB 이하";
}
