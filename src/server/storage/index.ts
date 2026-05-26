import { createLocalMetadataStorageAdapter } from "./local-metadata-storage-adapter";
import { createS3MetadataStorageAdapter } from "./s3-metadata-storage-adapter";
import type { ReviewStorageAdapter } from "./storage-adapter";

export function getReviewStorageAdapter(): ReviewStorageAdapter {
  const adapter = process.env.FINPROOF_STORAGE_ADAPTER ?? "local-metadata";

  if (adapter === "local-metadata") {
    return createLocalMetadataStorageAdapter();
  }

  if (adapter === "s3") {
    const bucket = process.env.FINPROOF_S3_BUCKET;
    const region = process.env.AWS_REGION;

    if (!bucket || !region) {
      throw new Error("FINPROOF_S3_BUCKET and AWS_REGION are required for S3 storage");
    }

    return createS3MetadataStorageAdapter({ bucket, region });
  }

  throw new Error(`Unsupported FINPROOF_STORAGE_ADAPTER: ${adapter}`);
}

export type { ReviewStorageAdapter, StoredFileMetadata } from "./storage-adapter";
