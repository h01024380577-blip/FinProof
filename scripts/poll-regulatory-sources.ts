import "dotenv/config";
import type { RequestContext } from "@/server/auth/request-context";
import { createRegulatorySourcePoller } from "@/server/regulatory/regulatory-source-poller";

function reviewerContext(): RequestContext {
  return {
    tenantId: process.env.FINPROOF_DEFAULT_TENANT_ID ?? "tenant-demo",
    userId: process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo",
    role: "reviewer"
  } as RequestContext;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const loop = args.has("--loop");
  const intervalMs = Number(process.env.FINPROOF_REGULATORY_POLL_INTERVAL_MS ?? "86400000");
  const poller = createRegulatorySourcePoller({
    onChange: (info) =>
      console.log(`[regulatory-poll] CHANGE detected: ${info.name} (${info.changeSetCount} change-set)`)
  });

  do {
    const summary = await poller.pollAll(reviewerContext());
    console.log(`[regulatory-poll] ${JSON.stringify(summary)}`);
    if (loop) {
      await sleep(Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 86_400_000);
    }
  } while (loop);
}

main().catch((error) => {
  console.error("[regulatory-poll] fatal:", error);
  process.exit(1);
});
