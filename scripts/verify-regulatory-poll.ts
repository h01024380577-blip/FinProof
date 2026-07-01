import "dotenv/config";
import type { RequestContext } from "@/server/auth/request-context";
import { getReviewStore } from "@/server/reviews";
import { createKoreanLawMcpClient } from "@/server/regulatory/korean-law-mcp-client";
import { createRegulatorySourcePoller } from "@/server/regulatory/regulatory-source-poller";

/**
 * DRY-RUN baseline poll verification.
 * - Reads REAL registered knowledge documents from the configured store.
 * - Performs REAL korean-law-mcp fetches (search_law + get_law_text) per law doc.
 * - Stubs every DB/storage WRITE so nothing is persisted (safe against prod).
 * It reproduces exactly what a first (baseline) poll would do, without mutating anything.
 */
function reviewerContext(): RequestContext {
  return {
    tenantId: process.env.FINPROOF_DEFAULT_TENANT_ID ?? "tenant-demo",
    userId: process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo",
    role: "reviewer"
  } as RequestContext;
}

async function main() {
  const realStore = getReviewStore();
  let wouldCreateSources = 0;
  let auditWrites = 0;
  const checks: Array<Record<string, unknown>> = [];

  const dryStore = {
    listKnowledgeDocuments: (scope: unknown) =>
      (realStore as { listKnowledgeDocuments: (s: unknown) => Promise<unknown[]> }).listKnowledgeDocuments(scope),
    getRegulatorySource: (scope: unknown, id: string) =>
      (realStore as { getRegulatorySource: (s: unknown, i: string) => Promise<unknown> }).getRegulatorySource(scope, id),
    getLatestRegulatorySnapshot: (scope: unknown, id: string) =>
      (realStore as { getLatestRegulatorySnapshot: (s: unknown, i: string) => Promise<unknown> }).getLatestRegulatorySnapshot(scope, id),
    createRegulatorySource: async (_scope: unknown, input: { id: string }) => {
      wouldCreateSources += 1;
      return { id: input.id };
    },
    recordAuditEvent: async () => {
      auditWrites += 1;
    }
  };

  const dryStorage = {
    getRegulatorySourceText: async () => null,
    putRegulatorySourceText: async () => undefined,
    getRegulatoryLawId: async () => null,
    putRegulatoryLawId: async () => undefined
  };

  const runSourceCheckStub = async (
    _ctx: unknown,
    input: { sourceId: string; title: string; sourceText: string; effectiveFrom?: string; baselineOnly?: boolean }
  ) => {
    checks.push({
      title: input.title,
      chars: input.sourceText.length,
      effectiveFrom: input.effectiveFrom ?? null,
      baselineOnly: input.baselineOnly
    });
    return {
      sourceId: input.sourceId,
      snapshotCreated: true,
      activated: false,
      changeSetCount: 0,
      activatedDocumentIds: []
    };
  };

  const poller = createRegulatorySourcePoller({
    store: dryStore as never,
    storage: dryStorage as never,
    runSourceCheck: runSourceCheckStub as never,
    lawClient: createKoreanLawMcpClient(),
    onChange: (info) => console.log("[dry-run] onChange:", JSON.stringify(info))
  });

  console.log(`[dry-run] store=${process.env.FINPROOF_REVIEW_STORE ?? "?"} — DB/storage WRITES are stubbed; MCP fetches are REAL. No mutation.`);
  const summary = await poller.pollAll(reviewerContext());
  console.log("[dry-run] summary:", JSON.stringify(summary));
  console.log(`[dry-run] would-create sources: ${wouldCreateSources}, audit writes suppressed: ${auditWrites}`);
  console.log("[dry-run] per-law baseline inputs (what runSourceCheck would receive):");
  for (const c of checks) {
    console.log("  -", JSON.stringify(c));
  }
}

main().catch((error) => {
  console.error("[dry-run] fatal:", error);
  process.exit(1);
});
