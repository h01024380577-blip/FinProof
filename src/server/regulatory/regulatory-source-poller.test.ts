// src/server/regulatory/regulatory-source-poller.test.ts
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@/server/auth/request-context";
import { createRegulatorySourcePoller } from "./regulatory-source-poller";

const context: RequestContext = {
  tenantId: "tenant-demo",
  userId: "user-reviewer-demo",
  role: "reviewer"
} as RequestContext;

function deps(overrides: Record<string, unknown> = {}) {
  const runSourceCheck = vi.fn(async () => ({
    sourceId: "src-1",
    snapshotCreated: true,
    activated: true,
    changeSetCount: 1,
    activatedDocumentIds: ["doc-1"]
  }));
  return {
    runSourceCheck,
    store: {
      listRegulatorySources: vi.fn(async () => [
        {
          id: "src-1",
          tenantId: "tenant-demo",
          sourceType: "law",
          name: "금융소비자보호법",
          url: "lawId=123456",
          pollingSchedule: "0 9 * * *",
          trustLevel: "official",
          status: "active",
          createdAt: "",
          updatedAt: ""
        }
      ]),
      getLatestRegulatorySnapshot: vi.fn(async () => null),
      updateRegulatorySource: vi.fn(async () => undefined),
      recordAuditEvent: vi.fn(async () => undefined)
    },
    storage: {
      getRegulatorySourceText: vi.fn(async () => null),
      putRegulatorySourceText: vi.fn(async () => undefined)
    },
    lawClient: {
      getLawText: vi.fn(async () => ({
        text: "공포일: 2026-01-01\n시행일: 2026-07-01\n[현행]\n제1조 v1",
        effectiveFrom: "2026-07-01",
        isCurrent: true
      }))
    },
    ...overrides
  };
}

describe("createRegulatorySourcePoller", () => {
  it("runs baselineOnly on first poll and stores fetched text", async () => {
    const d = deps();
    const poller = createRegulatorySourcePoller(d as never);

    const summary = await poller.pollAll(context);

    expect(d.lawClient.getLawText).toHaveBeenCalledWith({ lawId: "123456" });
    const checkArg = d.runSourceCheck.mock.calls[0][1];
    expect(checkArg.baselineOnly).toBe(true);
    expect(checkArg.activateKnowledgeDocument).toBe(true);
    expect(checkArg.previousNormalizedText).toBeUndefined();
    expect(d.storage.putRegulatorySourceText).toHaveBeenCalledWith({
      sourceId: "src-1",
      tenantId: "tenant-demo",
      text: "공포일: 2026-01-01\n시행일: 2026-07-01\n[현행]\n제1조 v1"
    });
    expect(summary.checked).toBe(1);
    expect(summary.changed).toBe(1);
  });

  it("passes previous text when a snapshot already exists", async () => {
    const d = deps({
      store: {
        ...deps().store,
        getLatestRegulatorySnapshot: vi.fn(async () => ({ id: "snap-0", contentHash: "x" }))
      },
      storage: {
        getRegulatorySourceText: vi.fn(async () => "제1조 v0"),
        putRegulatorySourceText: vi.fn(async () => undefined)
      }
    });
    const poller = createRegulatorySourcePoller(d as never);

    await poller.pollAll(context);

    const checkArg = d.runSourceCheck.mock.calls[0][1];
    expect(checkArg.baselineOnly).toBe(false);
    expect(checkArg.previousNormalizedText).toBe("제1조 v0");
  });

  it("skips sources without a law identifier and records failure without throwing", async () => {
    const d = deps({
      store: {
        ...deps().store,
        listRegulatorySources: vi.fn(async () => [
          { id: "src-x", tenantId: "tenant-demo", sourceType: "law", name: "no-id", pollingSchedule: "manual", trustLevel: "official", status: "active", createdAt: "", updatedAt: "" }
        ])
      }
    });
    const poller = createRegulatorySourcePoller(d as never);

    const summary = await poller.pollAll(context);

    expect(d.runSourceCheck).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });
});
