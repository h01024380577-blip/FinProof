import type {
  PutKnowledgeDocumentFileInput,
  PutReviewFileInput,
  ReviewStorageAdapter,
  SampleReviewFileInput,
  StoredFileMetadata
} from "./storage-adapter";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type LocalMetadataStorageAdapterOptions = {
  rootDir?: string;
};

function normalizeFileName(fileName: string) {
  return fileName.replaceAll("/", "_").replaceAll("\\", "_");
}

function defaultLocalUploadRoot() {
  return process.env.FINPROOF_LOCAL_UPLOAD_DIR?.trim() || path.join("/tmp", "finproof-uploads");
}

function storagePath(rootDir: string, storageKey: string) {
  if (!storageKey.startsWith("local/")) {
    return undefined;
  }

  const relativePath = storageKey
    .replace(/^local\//, "")
    .split("/")
    .map((segment) => normalizeFileName(segment))
    .join(path.sep);

  return path.join(/* turbopackIgnore: true */ rootDir, relativePath);
}

export function createLocalMetadataStorageAdapter({
  rootDir = defaultLocalUploadRoot()
}: LocalMetadataStorageAdapterOptions = {}): ReviewStorageAdapter {
  return {
    async putReviewFile(input: PutReviewFileInput): Promise<StoredFileMetadata> {
      const storageKey = `local/${input.reviewCaseId}/${input.fileId}/${normalizeFileName(
        input.fileName
      )}`;
      const targetPath = storagePath(rootDir, storageKey);

      if (!targetPath) {
        throw new Error(`Invalid local storage key: ${storageKey}`);
      }

      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, input.body);

      return {
        storageProvider: "local",
        storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes
      };
    },

    async putKnowledgeDocumentFile(
      input: PutKnowledgeDocumentFileInput
    ): Promise<StoredFileMetadata> {
      const storageKey = `local/knowledge-documents/${input.documentId}/${normalizeFileName(
        input.fileName
      )}`;
      const targetPath = storagePath(rootDir, storageKey);

      if (!targetPath) {
        throw new Error(`Invalid local storage key: ${storageKey}`);
      }

      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, input.body);

      return {
        storageProvider: "local",
        storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes
      };
    },

    async getFileBody(storageKey: string): Promise<Uint8Array | undefined> {
      const targetPath = storagePath(rootDir, storageKey);

      if (!targetPath) {
        return undefined;
      }

      try {
        return Uint8Array.from(await readFile(targetPath));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return undefined;
        }

        throw error;
      }
    },

    async getReviewFileBody(storageKey: string): Promise<Uint8Array | undefined> {
      return this.getFileBody(storageKey);
    },

    sampleReviewFile(input: SampleReviewFileInput): StoredFileMetadata {
      return {
        storageProvider: "sample",
        storageKey: `sample/${input.reviewCaseId}/${normalizeFileName(input.fileName)}`,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes
      };
    }
  };
}
