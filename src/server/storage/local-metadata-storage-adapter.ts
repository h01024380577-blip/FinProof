import type {
  PutReviewFileInput,
  ReviewStorageAdapter,
  SampleReviewFileInput,
  StoredFileMetadata
} from "./storage-adapter";

function normalizeFileName(fileName: string) {
  return fileName.replaceAll("/", "_").replaceAll("\\", "_");
}

export function createLocalMetadataStorageAdapter(): ReviewStorageAdapter {
  return {
    async putReviewFile(input: PutReviewFileInput): Promise<StoredFileMetadata> {
      return {
        storageProvider: "local",
        storageKey: `local/${input.reviewCaseId}/${input.fileId}/${normalizeFileName(input.fileName)}`,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes
      };
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
