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

// Korean object keys can be stored under a different Unicode normalization (NFC vs NFD)
// than the DB storage_key — e.g. an object PUT by one tool while the DB row was written by
// another. S3 GetObject matches keys byte-for-byte, so a normalization mismatch surfaces as
// NoSuchKey and silently strands the upload as metadata-only (the local adapter already
// normalizes for the same reason). Try the exact key first, then the alternate forms.
function keyNormalizationCandidates(key: string): string[] {
  return [...new Set([key, key.normalize("NFC"), key.normalize("NFD")])];
}

async function getObjectBodyWithNormalizationFallback(
  client: S3ObjectClient,
  bucket: string,
  key: string
): Promise<Uint8Array | undefined> {
  let lastNotFound: unknown;

  for (const candidate of keyNormalizationCandidates(key)) {
    try {
      const response = (await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: candidate })
      )) as { Body?: unknown };

      return bodyToUint8Array(response.Body);
    } catch (error) {
      const name = (error as { name?: string }).name;

      if (name === "NoSuchKey" || name === "NotFound") {
        lastNotFound = error;
        continue;
      }

      throw error;
    }
  }

  throw lastNotFound;
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

      return getObjectBodyWithNormalizationFallback(client, bucket, key);
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
    },

    async putRegulatorySourceText(input: {
      sourceId: string;
      tenantId: string;
      text: string;
    }): Promise<void> {
      const key = `regulatory/source-text/${input.tenantId}/${input.sourceId}.txt`;

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: input.text,
          ContentType: "text/plain; charset=utf-8"
        })
      );
    },

    async getRegulatorySourceText(input: {
      sourceId: string;
      tenantId: string;
    }): Promise<string | null> {
      const key = `regulatory/source-text/${input.tenantId}/${input.sourceId}.txt`;

      try {
        const response = (await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key
          })
        )) as { Body?: { transformToString: (encoding?: string) => Promise<string> } };

        return (await response.Body?.transformToString("utf-8")) ?? null;
      } catch (error) {
        const name = (error as { name?: string }).name;

        if (name === "NoSuchKey" || name === "NotFound") {
          return null;
        }

        throw error;
      }
    },

    async putRegulatoryLawId(input: {
      sourceId: string;
      tenantId: string;
      lawId: string;
    }): Promise<void> {
      const key = `regulatory/law-id/${input.tenantId}/${input.sourceId}.txt`;

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: input.lawId,
          ContentType: "text/plain; charset=utf-8"
        })
      );
    },

    async getRegulatoryLawId(input: {
      sourceId: string;
      tenantId: string;
    }): Promise<string | null> {
      const key = `regulatory/law-id/${input.tenantId}/${input.sourceId}.txt`;

      try {
        const response = (await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key
          })
        )) as { Body?: { transformToString: (encoding?: string) => Promise<string> } };

        return (await response.Body?.transformToString("utf-8")) ?? null;
      } catch (error) {
        const name = (error as { name?: string }).name;

        if (name === "NoSuchKey" || name === "NotFound") {
          return null;
        }

        throw error;
      }
    }
  };
}
