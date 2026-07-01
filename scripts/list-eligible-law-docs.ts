import "dotenv/config";
import type { RequestContext } from "@/server/auth/request-context";
import type { KnowledgeDocument } from "@/domain/types";
import { getReviewStore } from "@/server/reviews";
import { stableRegulatorySourceId } from "@/server/regulatory/knowledge-document-source-mapping";

// Read-only: lists the law-type knowledge documents the poller considers, grouped
// the same way (stableRegulatorySourceId), so we can see the full target set.
function reviewerContext(): RequestContext {
  return {
    tenantId: process.env.FINPROOF_DEFAULT_TENANT_ID ?? "tenant-demo",
    userId: process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo",
    role: "reviewer"
  } as RequestContext;
}

const ADMIN_RULE = /규정|고시|훈령|예규|지침|세칙/;

async function main() {
  const context = reviewerContext();
  const store = getReviewStore();
  const docs = (
    (await (store as { listKnowledgeDocuments: (s: unknown) => Promise<KnowledgeDocument[]> }).listKnowledgeDocuments(
      context as unknown
    )) as KnowledgeDocument[]
  ).filter(
    (d) =>
      d.documentType === "law" &&
      d.approvalStatus === "approved" &&
      d.lifecycleStatus !== "superseded" &&
      !d.autoIngested
  );

  const groups = new Map<string, KnowledgeDocument[]>();
  for (const d of docs) {
    const id = stableRegulatorySourceId(d);
    groups.set(id, [...(groups.get(id) ?? []), d]);
  }

  console.log(`[list] eligible law documents: ${docs.length}, groups(sources): ${groups.size}`);
  let i = 0;
  for (const [, group] of groups) {
    const d = group[group.length - 1];
    i += 1;
    console.log(
      `${String(i).padStart(2, "0")}. ${ADMIN_RULE.test(d.title) ? "[행정규칙]" : "[법령]  "} ${d.title}` +
        (group.length > 1 ? `  (버전 ${group.length}개)` : "")
    );
  }
}

main().catch((error) => {
  console.error("[list] fatal:", error);
  process.exit(1);
});
