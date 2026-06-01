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
  const extension = fileName.toLowerCase().split(".").pop() ?? "";

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
    normalizedName.includes("홍보물") ||
    normalizedName.includes("시안") ||
    contentType.startsWith("image/")
  ) {
    return "promotional_creative";
  }

  if (
    normalizedName.includes("copy") ||
    normalizedName.includes("draft") ||
    normalizedName.includes("카피")
  ) {
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

  if (normalizedName.includes("checklist") || normalizedName.includes("체크리스트")) {
    return "checklist";
  }

  if (
    normalizedName.includes("rate") ||
    normalizedName.includes("금리") ||
    normalizedName.endsWith(".xlsx")
  ) {
    return "rate_table";
  }

  if (normalizedName.includes("url")) {
    return "url_list";
  }

  return "misc";
}

export function formatUploadPolicySummary(): string {
  return "PDF, PNG, JPG/JPEG, TXT, DOCX, XLSX, CSV, HTML, ZIP · 최대 10개 · 일반 파일 25MB, ZIP 100MB 이하";
}
