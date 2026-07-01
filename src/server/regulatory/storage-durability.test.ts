import { describe, expect, it } from "vitest";
import { assessRegulatoryStorageDurability } from "./storage-durability";

describe("assessRegulatoryStorageDurability", () => {
  it("treats S3 as durable", () => {
    const result = assessRegulatoryStorageDurability({ FINPROOF_STORAGE_ADAPTER: "s3" });
    expect(result.durable).toBe(true);
  });

  it("flags the default /tmp local path as not durable", () => {
    const result = assessRegulatoryStorageDurability({ FINPROOF_STORAGE_ADAPTER: "local-metadata" });
    expect(result.durable).toBe(false);
    expect(result.detail).toContain("/tmp");
  });

  it("flags an explicit /tmp upload dir as not durable", () => {
    const result = assessRegulatoryStorageDurability({
      FINPROOF_STORAGE_ADAPTER: "local-metadata",
      FINPROOF_LOCAL_UPLOAD_DIR: "/tmp/finproof-uploads"
    });
    expect(result.durable).toBe(false);
  });

  it("treats a local persistent dir as durable", () => {
    const result = assessRegulatoryStorageDurability({
      FINPROOF_STORAGE_ADAPTER: "local-metadata",
      FINPROOF_LOCAL_UPLOAD_DIR: "/home/ec2-user/finproof-data"
    });
    expect(result.durable).toBe(true);
  });

  it("defaults to local-metadata (not durable) when unset", () => {
    const result = assessRegulatoryStorageDurability({});
    expect(result.adapter).toBe("local-metadata");
    expect(result.durable).toBe(false);
  });

  it("reports an unknown adapter as not durable", () => {
    const result = assessRegulatoryStorageDurability({ FINPROOF_STORAGE_ADAPTER: "gcs" });
    expect(result.durable).toBe(false);
    expect(result.detail).toContain("gcs");
  });
});
