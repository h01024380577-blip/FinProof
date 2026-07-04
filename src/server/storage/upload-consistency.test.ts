import { describe, expect, it, vi } from "vitest";
import {
  assessUploadStorageConsistency,
  classifyUnservableFile,
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
