import { createLocalMetadataStorageAdapter } from "./local-metadata-storage-adapter";
import { getReviewStorageAdapter } from ".";
import { createS3MetadataStorageAdapter } from "./s3-metadata-storage-adapter";

describe("local metadata storage adapter", () => {
  it("creates deterministic review file metadata for local demo uploads", async () => {
    const adapter = createLocalMetadataStorageAdapter();

    const result = await adapter.putReviewFile({
      reviewCaseId: "rc-upload-001",
      fileId: "file-upload-001",
      fileName: "real-deposit-poster.png",
      contentType: "image/png",
      sizeBytes: 2048,
      body: new Uint8Array([1, 2, 3])
    });

    expect(result).toEqual({
      storageProvider: "local",
      storageKey: "local/rc-upload-001/file-upload-001/real-deposit-poster.png",
      contentType: "image/png",
      sizeBytes: 2048
    });
  });

  it("creates sample metadata for seeded files", () => {
    const adapter = createLocalMetadataStorageAdapter();

    expect(
      adapter.sampleReviewFile({
        reviewCaseId: "rc-demo-deposit-001",
        fileName: "deposit-poster.png",
        contentType: "image/png",
        sizeBytes: 1024
      })
    ).toEqual({
      storageProvider: "sample",
      storageKey: "sample/rc-demo-deposit-001/deposit-poster.png",
      contentType: "image/png",
      sizeBytes: 1024
    });
  });
});

describe("storage adapter factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates an S3 adapter when configured", () => {
    process.env.FINPROOF_STORAGE_ADAPTER = "s3";
    process.env.FINPROOF_S3_BUCKET = "finproof-prod-artifacts";
    process.env.AWS_REGION = "ap-northeast-2";

    const adapter = getReviewStorageAdapter();

    expect(adapter).toEqual({
      putReviewFile: expect.any(Function),
      sampleReviewFile: expect.any(Function)
    });
  });

  it("uploads S3 objects before returning metadata", async () => {
    const send = vi.fn().mockResolvedValue({});
    const body = new Uint8Array([1, 2, 3]);
    const adapter = createS3MetadataStorageAdapter({
      bucket: "finproof-prod-artifacts",
      region: "ap-northeast-2",
      client: { send }
    });

    const metadata = await adapter.putReviewFile({
      reviewCaseId: "rc-prod-001",
      fileId: "file-001",
      fileName: "nested/poster.png",
      contentType: "image/png",
      sizeBytes: body.byteLength,
      body
    });
    const command = send.mock.calls[0]?.[0] as { input?: Record<string, unknown> } | undefined;

    expect(send).toHaveBeenCalledTimes(1);
    expect(command?.input).toMatchObject({
      Bucket: "finproof-prod-artifacts",
      Key: "reviews/rc-prod-001/file-001/nested_poster.png",
      ContentType: "image/png",
      Body: body
    });
    expect(metadata).toEqual({
      storageProvider: "s3",
      storageKey: "s3://finproof-prod-artifacts/reviews/rc-prod-001/file-001/nested_poster.png",
      contentType: "image/png",
      sizeBytes: 3
    });
  });
});
