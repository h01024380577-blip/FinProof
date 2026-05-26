import { createLocalMetadataStorageAdapter } from "./local-metadata-storage-adapter";
import { getReviewStorageAdapter } from ".";
import { createS3MetadataStorageAdapter } from "./s3-metadata-storage-adapter";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

  it("persists and reads local upload bytes for real analysis", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "finproof-storage-"));
    const adapter = createLocalMetadataStorageAdapter({ rootDir });
    const body = new TextEncoder().encode("최고 연 5.0% 우대 조건 안내");

    const metadata = await adapter.putReviewFile({
      reviewCaseId: "rc-upload-001",
      fileId: "file-upload-001",
      fileName: "nested/poster.txt",
      contentType: "text/plain",
      sizeBytes: body.byteLength,
      body
    });

    const storedBody = await adapter.getReviewFileBody(metadata.storageKey);

    expect(Array.from(storedBody ?? [])).toEqual(Array.from(body));
  });

  it("persists and reads local knowledge document bytes", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "finproof-storage-"));
    const adapter = createLocalMetadataStorageAdapter({ rootDir });
    const body = new TextEncoder().encode("예금 광고 심의 지침");

    const metadata = await adapter.putKnowledgeDocumentFile({
      documentId: "knowledge-001",
      fileName: "nested/deposit-policy.txt",
      contentType: "text/plain",
      sizeBytes: body.byteLength,
      body
    });

    expect(metadata.storageKey).toBe(
      "local/knowledge-documents/knowledge-001/nested_deposit-policy.txt"
    );
    const storedBody = await adapter.getFileBody(metadata.storageKey);

    expect(Array.from(storedBody ?? [])).toEqual(Array.from(body));
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

    expect(adapter).toEqual(
      expect.objectContaining({
        putReviewFile: expect.any(Function),
        getReviewFileBody: expect.any(Function),
        putKnowledgeDocumentFile: expect.any(Function),
        getFileBody: expect.any(Function),
        sampleReviewFile: expect.any(Function)
      })
    );
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

  it("uploads S3 knowledge document objects", async () => {
    const send = vi.fn().mockResolvedValue({});
    const body = new Uint8Array([1, 2, 3]);
    const adapter = createS3MetadataStorageAdapter({
      bucket: "finproof-prod-artifacts",
      region: "ap-northeast-2",
      client: { send }
    });

    const metadata = await adapter.putKnowledgeDocumentFile({
      documentId: "knowledge-001",
      fileName: "nested/deposit-policy.txt",
      contentType: "text/plain",
      sizeBytes: body.byteLength,
      body
    });
    const command = send.mock.calls[0]?.[0] as { input?: Record<string, unknown> } | undefined;

    expect(command?.input).toMatchObject({
      Bucket: "finproof-prod-artifacts",
      Key: "knowledge-documents/knowledge-001/nested_deposit-policy.txt",
      ContentType: "text/plain",
      Body: body
    });
    expect(metadata.storageKey).toBe(
      "s3://finproof-prod-artifacts/knowledge-documents/knowledge-001/nested_deposit-policy.txt"
    );
  });
});
