export type StoredFileMetadata = {
  storageProvider: "sample" | "local" | "s3";
  storageKey: string;
  contentType: string;
  sizeBytes: number;
};

export type PutReviewFileInput = {
  reviewCaseId: string;
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  body: Uint8Array;
};

export type PutKnowledgeDocumentFileInput = {
  documentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  body: Uint8Array;
};

export type SampleReviewFileInput = {
  reviewCaseId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export interface ReviewStorageAdapter {
  putReviewFile(input: PutReviewFileInput): Promise<StoredFileMetadata>;
  putKnowledgeDocumentFile(input: PutKnowledgeDocumentFileInput): Promise<StoredFileMetadata>;
  getReviewFileBody(storageKey: string): Promise<Uint8Array | undefined>;
  getFileBody(storageKey: string): Promise<Uint8Array | undefined>;
  sampleReviewFile(input: SampleReviewFileInput): StoredFileMetadata;
}
