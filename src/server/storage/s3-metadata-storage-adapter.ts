import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  PutKnowledgeDocumentFileInput,
  PutReviewFileInput,
  ReviewStorageAdapter,
  SampleReviewFileInput,
  StoredFileMetadata
} from "./storage-adapter";

type S3ObjectClient = {
  send(command: PutObjectCommand | GetObjectCommand): Promise<unknown>;
};

type S3MetadataStorageAdapterOptions = {
  bucket: string;
  region: string;
  prefix?: string;
  client?: S3ObjectClient;
};

function normalizeFileName(fileName: string) {
  return fileName.replaceAll("/", "_").replaceAll("\\", "_");
}

function normalizePrefix(prefix: string) {
  return prefix.replace(/^\/+|\/+$/g, "");
}

function parseS3StorageKey(storageKey: string, bucket: string) {
  const prefix = `s3://${bucket}/`;

  if (!storageKey.startsWith(prefix)) {
    return undefined;
  }

  return storageKey.slice(prefix.length);
}

async function bodyToUint8Array(body: unknown): Promise<Uint8Array | undefined> {
  if (!body) {
    return undefined;
  }

  if (body instanceof Uint8Array) {
    return body;
  }

  if (typeof body === "object" && "transformToByteArray" in body) {
    const transform = body.transformToByteArray;

    if (typeof transform === "function") {
      return transform.call(body);
    }
  }

  if (typeof body === "object" && "arrayBuffer" in body) {
    const arrayBuffer = body.arrayBuffer;

    if (typeof arrayBuffer === "function") {
      return new Uint8Array(await arrayBuffer.call(body));
    }
  }

  return undefined;
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

    async putKnowledgeDocumentFile(
      input: PutKnowledgeDocumentFileInput
    ): Promise<StoredFileMetadata> {
      const key = `knowledge-documents/${input.documentId}/${normalizeFileName(input.fileName)}`;

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

    async getFileBody(storageKey: string): Promise<Uint8Array | undefined> {
      const key = parseS3StorageKey(storageKey, bucket);

      if (!key) {
        return undefined;
      }

      const response = (await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key
        })
      )) as { Body?: unknown };

      return bodyToUint8Array(response.Body);
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
