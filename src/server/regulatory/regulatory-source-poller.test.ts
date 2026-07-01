import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@/server/auth/request-context";
import { createRegulatorySourcePoller } from "./regulatory-source-poller";

const context: RequestContext = {
  tenantId: "tenant-demo",
  userId: "user-reviewer-demo",
  role: "reviewer"
} as RequestContext;

function lawDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "knowledge-law-fcpa",
    tenantId: "tenant-demo",
    documentType: "law",
    title: "금융소비자 보호에 관한 법률",
    version: "2026-01-01",
    effectiveFrom: "2026-01-01",
    approvalStatus: "approved",
    lifecycleStatus: "active",
    autoIngested: false,
    storageKey: "k",
    createdBy: "u",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  const runSourceCheck = vi.fn(async () => ({
    sourceId: "s",
    snapshotCreated: true,
    activated: true,
    changeSetCount: 1,
    activatedDocumentIds: ["d"]
  }));
  const base = {
    runSourceCheck,
    store: {
      listKnowledgeDocuments: vi.fn(async () => [lawDoc()]),
      getRegulatorySource: vi.fn(async () => undefined),
      createRegulatorySource: vi.fn(async (_scope: unknown, input: { id: string }) => ({ id: input.id })),
      getLatestRegulatorySnapshot: vi.fn(async () => null),
      recordAuditEvent: vi.fn(async () => undefined)
    },
    storage: {
      getRegulatorySourceText: vi.fn(async () => null),
      putRegulatorySourceText: vi.fn(async () => undefined),
      getRegulatoryLawId: vi.fn(async () => null),
      putRegulatoryLawId: vi.fn(async () => undefined)
    },
    lawClient: {
      getLawText: vi.fn(async () => ({ text: "시행일: 2026-07-01\n[현행]\n제1조 v1", effectiveFrom: "2026-07-01", isCurrent: true })),
      searchLaw: vi.fn(async () => ({ lawId: "001234" }))
    }
  };
  return { ...base, ...overrides };
}

describe("createRegulatorySourcePoller (knowledge-document anchored)", () => {
  it("resolves law id via search_law, caches it, creates source, and baselines on first poll", async () => {
    const d = deps();
    const summary = await createRegulatorySourcePoller(d as never).pollAll(context);

    expect(d.lawClient.searchLaw).toHaveBeenCalledWith("금융소비자 보호에 관한 법률");
    expect(d.storage.putRegulatoryLawId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-demo", lawId: "lawId=001234" })
    );
    expect(d.lawClient.getLawText).toHaveBeenCalledWith({ lawId: "001234" });
    expect(d.store.createRegulatorySource).toHaveBeenCalledTimes(1);
    const checkArg = d.runSourceCheck.mock.calls[0][1];
    expect(checkArg.baselineOnly).toBe(true);
    expect(checkArg.documentType).toBe("law");
    expect(d.storage.putRegulatorySourceText).toHaveBeenCalled();
    expect(summary).toEqual({ checked: 1, changed: 1, skipped: 0, failed: 0 });
  });

  it("uses the cached law id and does not call search_law", async () => {
    const d = deps({
      storage: {
        ...deps().storage,
        getRegulatoryLawId: vi.fn(async () => "lawId=999")
      }
    });
    await createRegulatorySourcePoller(d as never).pollAll(context);

    expect(d.lawClient.searchLaw).not.toHaveBeenCalled();
    expect(d.lawClient.getLawText).toHaveBeenCalledWith({ lawId: "999" });
  });

  it("passes previous text and baselineOnly=false when a snapshot exists", async () => {
    const d = deps({
      store: { ...deps().store, getLatestRegulatorySnapshot: vi.fn(async () => ({ id: "snap", contentHash: "x" })) },
      storage: { ...deps().storage, getRegulatorySourceText: vi.fn(async () => "제1조 v0") }
    });
    await createRegulatorySourcePoller(d as never).pollAll(context);

    const checkArg = d.runSourceCheck.mock.calls[0][1];
    expect(checkArg.baselineOnly).toBe(false);
    expect(checkArg.previousNormalizedText).toBe("제1조 v0");
  });

  it("skips + audits when the law id cannot be resolved", async () => {
    const d = deps({
      lawClient: { ...deps().lawClient, searchLaw: vi.fn(async () => ({})) }
    });
    const summary = await createRegulatorySourcePoller(d as never).pollAll(context);

    expect(d.runSourceCheck).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(d.store.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ afterValue: expect.objectContaining({ reason: "law_id_unresolved" }) })
    );
  });

  it("audits the search_law resolution with the matched title", async () => {
    const d = deps({
      lawClient: {
        ...deps().lawClient,
        searchLaw: vi.fn(async () => ({ lawId: "001234", title: "금융소비자 보호에 관한 법률" }))
      }
    });
    await createRegulatorySourcePoller(d as never).pollAll(context);

    expect(d.store.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "regulatory_source.law_id_resolved",
        afterValue: expect.objectContaining({ resolvedIdentifier: "lawId=001234", method: "search_law" })
      })
    );
  });

  it("ignores non-law, unapproved, superseded and auto-ingested documents", async () => {
    const d = deps({
      store: {
        ...deps().store,
        listKnowledgeDocuments: vi.fn(async () => [
          lawDoc({ id: "a", documentType: "internal_policy" }),
          lawDoc({ id: "b", approvalStatus: "pending" }),
          lawDoc({ id: "c", lifecycleStatus: "superseded" }),
          lawDoc({ id: "d", autoIngested: true }),
          lawDoc({ id: "e" })
        ])
      }
    });
    const summary = await createRegulatorySourcePoller(d as never).pollAll(context);

    expect(summary.checked).toBe(1);
    expect(d.lawClient.getLawText).toHaveBeenCalledTimes(1);
  });

  it("does not abort the run when an audit write fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      lawClient: { ...deps().lawClient, searchLaw: vi.fn(async () => ({})) },
      store: { ...deps().store, recordAuditEvent: vi.fn(async () => { throw new Error("db down"); }) }
    });
    const summary = await createRegulatorySourcePoller(d as never).pollAll(context);
    expect(summary.skipped).toBe(1);
    errorSpy.mockRestore();
  });
});
