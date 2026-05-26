import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  PutReviewFileInput,
  ReviewStorageAdapter,
  SampleReviewFileInput,
  StoredFileMetadata
} from "./storage-adapter";

type S3PutObjectClient = {
  send(command: PutObjectCommand): Promise<unknown>;
};

type S3MetadataStorageAdapterOptions = {
  bucket: string;
  region: string;
  prefix?: string;
  client?: S3PutObjectClient;
};

function normalizeFileName(fileName: string) {
  return fileName.replaceAll("/", "_").replaceAll("\\", "_");
}

function normalizePrefix(prefix: string) {
  return prefix.replace(/^\/+|\/+$/g, "");
}

export function createS3MetadataStorageAdapter({
  bucket,
  region,
  client = new S3Client({ region }),
  prefix = "reviews"
}: S3MetadataStorageAdapterOptions): ReviewStorageAdapter {
  const keyPrefix = normalizePrefix(prefix);

  return {
    async putReviewFile(input: PutReviewFileInput): Promise<StoredFileMetadata> {
      const key = `${keyPrefix}/${input.reviewCaseId}/${input.fileId}/${normalizeFileName(
        input.fileName
      )}`;

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: input.body,
          ContentType: input.contentType
        })
      );

      return {
        storageProvider: "s3",
        storageKey: `s3://${bucket}/${key}`,
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
