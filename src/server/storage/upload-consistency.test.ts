import { describe, expect, it, vi } from "vitest";
import {
  assertReviewSourcesServable,
  assessUploadStorageConsistency,
  classifyUnservableFile,
  describeUnservableFile,
  warnCrossEnvUpload
} from "./upload-consistency";

describe("assessUploadStorageConsistency", () => {
  it("flags local file storage combined with a remote database as orphan-prone", () => {
    const result = assessUploadStorageConsistency({
      FINPROOF_STORAGE_ADAPTER: "local-metadata",
      DATABASE_URL: "postgresql://user:pass@db.kjccoaxqafpblbfzdxyc.supabase.co:5432/postgres"
    });

    expect(result.risky).toBe(true);
    expect(result.adapter).toBe("local-metadata");
    expect(result.detail).toContain("orphan");
  });

  it("treats local file storage with a local database as safe", () => {
    const result = assessUploadStorageConsistency({
      FINPROOF_STORAGE_ADAPTER: "local-metadata",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/finproof"
    });

    expect(result.risky).toBe(false);
  });

  it("treats the s3 adapter as safe regardless of database location", () => {
    const result = assessUploadStorageConsistency({
      FINPROOF_STORAGE_ADAPTER: "s3",
      DATABASE_URL: "postgresql://user:pass@db.remote.supabase.co:5432/postgres"
    });

    expect(result.risky).toBe(false);
  });

  it("is not risky when no database url is configured (in-memory/tests)", () => {
    const result = assessUploadStorageConsistency({
      FINPROOF_STORAGE_ADAPTER: "local-metadata"
    });

    expect(result.risky).toBe(false);
  });

  it("defaults the adapter to local-metadata when unset", () => {
    const result = assessUploadStorageConsistency({
      DATABASE_URL: "postgresql://user:pass@db.remote.supabase.co:5432/postgres"
    });

    expect(result.adapter).toBe("local-metadata");
    expect(result.risky).toBe(true);
  });
});

describe("warnCrossEnvUpload", () => {
  it("emits a single structured warning when the configuration is orphan-prone", () => {
    const log = vi.fn();

    warnCrossEnvUpload(
      {
        FINPROOF_STORAGE_ADAPTER: "local-metadata",
        DATABASE_URL: "postgresql://user:pass@db.remote.supabase.co:5432/postgres"
      },
      log
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({
      evt: "storage",
      level: "warn",
      reason: "cross_env_upload"
    });
  });

  it("stays silent when the configuration is safe", () => {
    const log = vi.fn();

    warnCrossEnvUpload({ FINPROOF_STORAGE_ADAPTER: "s3", DATABASE_URL: "postgresql://u@localhost/db" }, log);

    expect(log).not.toHaveBeenCalled();
  });
});

describe("classifyUnservableFile", () => {
  it("reports provider_mismatch when the s3 adapter is asked for a local file", () => {
    expect(classifyUnservableFile({ FINPROOF_STORAGE_ADAPTER: "s3" }, "local")).toBe(
      "provider_mismatch"
    );
  });

  it("reports provider_mismatch when the local adapter is asked for an s3 file", () => {
    expect(classifyUnservableFile({ FINPROOF_STORAGE_ADAPTER: "local-metadata" }, "s3")).toBe(
      "provider_mismatch"
    );
  });

  it("reports bytes_missing when the provider matches the adapter but the body is gone", () => {
    expect(classifyUnservableFile({ FINPROOF_STORAGE_ADAPTER: "s3" }, "s3")).toBe("bytes_missing");
    expect(classifyUnservableFile({ FINPROOF_STORAGE_ADAPTER: "local-metadata" }, "local")).toBe(
      "bytes_missing"
    );
  });
});

describe("assertReviewSourcesServable", () => {
  const s3Env = { FINPROOF_STORAGE_ADAPTER: "s3" };

  it("throws an accurate provider-mismatch error when every review source is a local file under the s3 adapter", () => {
    // The rc-upload-003 orphan incident: all sources seeded via the local adapter,
    // served/analyzed by a prod s3 adapter. Fail fast with the real cause instead of
    // running OCR and aborting later with a misleading "OCR 설정 확인" message.
    let thrown: Error | undefined;
    try {
      assertReviewSourcesServable(s3Env, [
        { storageProvider: "local", name: "01_홍보물_시안.png" },
        { storageProvider: "local", name: "02_원문_카피.txt" }
      ]);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toContain("local");
    expect(thrown?.message).toContain("s3");
    expect(thrown?.message).toContain("다시 업로드");
    expect(thrown?.message).toContain("01_홍보물_시안.png");
  });

  it("does not throw when at least one review source is servable by the active adapter", () => {
    expect(() =>
      assertReviewSourcesServable(s3Env, [
        { storageProvider: "local", name: "orphan.png" },
        { storageProvider: "s3", name: "poster.png" }
      ])
    ).not.toThrow();
  });

  it("does not throw when every source matches the active adapter", () => {
    expect(() =>
      assertReviewSourcesServable(s3Env, [{ storageProvider: "s3", name: "poster.png" }])
    ).not.toThrow();
  });

  it("does not throw when there are no review sources to serve", () => {
    expect(() => assertReviewSourcesServable(s3Env, [])).not.toThrow();
  });

  it("does not hard-fail under a local-metadata adapter (dev/cross-env is a warning, not an orphan)", () => {
    // Only the durable shared adapter (s3) produces the unrecoverable orphan. A
    // local-metadata adapter reading s3-provider fixtures is the dev/test shape
    // surfaced by assessUploadStorageConsistency — extraction, not this guard, decides.
    expect(() =>
      assertReviewSourcesServable({ FINPROOF_STORAGE_ADAPTER: "local-metadata" }, [
        { storageProvider: "s3", name: "poster.png" }
      ])
    ).not.toThrow();
  });
});

describe("describeUnservableFile", () => {
  it("names the provider mismatch and its remedy so the viewer sees the real cause instead of a bare 404", () => {
    const result = describeUnservableFile("provider_mismatch");

    expect(result.code).toBe("STORAGE_PROVIDER_MISMATCH");
    expect(result.message).toContain("다시 업로드");
  });

  it("distinguishes genuinely missing bytes from a provider mismatch", () => {
    const result = describeUnservableFile("bytes_missing");

    expect(result.code).toBe("STORAGE_BYTES_MISSING");
    expect(result.message).not.toBe(describeUnservableFile("provider_mismatch").message);
  });
});
