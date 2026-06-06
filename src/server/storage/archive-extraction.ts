import path from "node:path";
import JSZip from "jszip";
import {
  normalizeUploadFileName,
  shouldIgnoreArchiveEntry,
  validateUploadedFiles
} from "@/domain/upload-policy";

export type UploadFileWithBody = {
  name: string;
  type: string;
  size: number;
  body: Uint8Array;
  sourceArchiveName?: string;
};

export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeArchiveError";
  }
}

const contentTypesByExtension: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  html: "text/html",
  zip: "application/zip"
};

function extensionFor(fileName: string) {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function contentTypeFor(fileName: string) {
  return contentTypesByExtension[extensionFor(fileName)] ?? "application/octet-stream";
}

function isZipFile(file: UploadFileWithBody) {
  return extensionFor(file.name) === "zip";
}

function safeEntryName(entryName: string) {
  const normalized = entryName.replaceAll("\\", "/");

  if (
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new UnsafeArchiveError(`Unsafe ZIP entry path: ${entryName}`);
  }

  return path.posix.normalize(normalized);
}

function shouldSkipEntry(entryName: string) {
  return shouldIgnoreArchiveEntry(entryName);
}

async function expandZipFile(file: UploadFileWithBody): Promise<UploadFileWithBody[]> {
  const zip = await JSZip.loadAsync(file.body);
  const extracted: UploadFileWithBody[] = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir || shouldSkipEntry(entry.name)) {
      continue;
    }

    const originalEntryName =
      "unsafeOriginalName" in entry && typeof entry.unsafeOriginalName === "string"
        ? entry.unsafeOriginalName
        : entry.name;
    const entryName = safeEntryName(normalizeUploadFileName(originalEntryName));
    const body = await entry.async("uint8array");
    const expandedFile = {
      name: `${file.name}/${entryName}`,
      type: contentTypeFor(entryName),
      size: body.byteLength,
      body,
      sourceArchiveName: file.name
    };
    const validation = validateUploadedFiles([expandedFile]);

    if (!validation.ok) {
      throw new UnsafeArchiveError(validation.errors.join(" "));
    }

    extracted.push(expandedFile);
  }

  return extracted;
}

export async function expandArchiveUploads(
  files: UploadFileWithBody[]
): Promise<UploadFileWithBody[]> {
  const expanded: UploadFileWithBody[] = [];

  for (const file of files) {
    expanded.push(file);

    if (isZipFile(file)) {
      expanded.push(...(await expandZipFile(file)));
    }
  }

  return expanded;
}
