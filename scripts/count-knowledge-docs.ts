import "dotenv/config";
import type { RequestContext } from "@/server/auth/request-context";
import type { KnowledgeDocument } from "@/domain/types";
import { getReviewStore } from "@/server/reviews";

// Read-only diagnostic: counts KnowledgeDocuments and RegulatorySources so we can
// see exactly what exists and whether the poll runs added anything.
function reviewerContext(): RequestContext {
  return {
    tenantId: process.env.FINPROOF_DEFAULT_TENANT_ID ?? "tenant-demo",
    userId: process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo",
    role: "reviewer"
  } as RequestContext;
}

async function main() {
  const context = reviewerContext();
  const store = getReviewStore() as {
    listKnowledgeDocuments: (s: unknown) => Promise<KnowledgeDocument[]>;
    listRegulatorySources?: (s: unknown) => Promise<Array<{ id: string; name: string; createdAt: string }>>;
  };

  const docs = await store.listKnowledgeDocuments(context as unknown);
  console.log(`[count] KnowledgeDocuments total: ${docs.length}`);

  const byType: Record<string, number> = {};
  const byLifecycle: Record<string, number> = {};
  let autoIngested = 0;
  for (const d of docs) {
    byType[d.documentType] = (byType[d.documentType] ?? 0) + 1;
    byLifecycle[d.lifecycleStatus ?? "(none)"] = (byLifecycle[d.lifecycleStatus ?? "(none)"] ?? 0) + 1;
    if (d.autoIngested) autoIngested += 1;
  }
  console.log(`[count] by documentType:`, JSON.stringify(byType));
  console.log(`[count] by lifecycleStatus:`, JSON.stringify(byLifecycle));
  console.log(`[count] autoIngested (poller/track-created) docs: ${autoIngested}`);

  const autoDocs = docs.filter((d) => d.autoIngested);
  if (autoDocs.length > 0) {
    console.log(`[count] autoIngested titles:`);
    for (const d of autoDocs) console.log(`   - ${d.title} (${d.createdAt})`);
  }

  const recent = [...docs].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 8);
  console.log(`[count] 8 most recently created docs:`);
  for (const d of recent) console.log(`   - ${d.createdAt}  ${d.documentType}  ${d.title}`);

  if (store.listRegulatorySources) {
    const sources = await store.listRegulatorySources(context as unknown);
    const mcp = sources.filter((s) => s.id.startsWith("mcp-"));
    console.log(`[count] RegulatorySources total: ${sources.length} (mcp- namespaced: ${mcp.length})`);
  }
}

main().catch((error) => {
  console.error("[count] fatal:", error);
  process.exit(1);
});
