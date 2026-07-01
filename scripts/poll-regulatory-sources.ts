import "dotenv/config";
import type { RequestContext } from "@/server/auth/request-context";
import { createRegulatorySourcePoller } from "@/server/regulatory/regulatory-source-poller";
import { assessRegulatoryStorageDurability } from "@/server/regulatory/storage-durability";

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

  // Guard against the ephemeral-storage footgun: baseline text under /tmp is lost on
  // reboot, which then fails every subsequent poll. Warn loudly; block if the deploy
  // opts into strict mode via FINPROOF_REGULATORY_REQUIRE_DURABLE_STORAGE.
  const durability = assessRegulatoryStorageDurability();
  if (!durability.durable) {
    console.warn(`[regulatory-poll] ⚠️  스토리지 경고: ${durability.detail}`);
    if ((process.env.FINPROOF_REGULATORY_REQUIRE_DURABLE_STORAGE ?? "").trim()) {
      console.error("[regulatory-poll] 내구성 스토리지 요구(FINPROOF_REGULATORY_REQUIRE_DURABLE_STORAGE) 설정으로 중단합니다.");
      process.exit(1);
    }
  }

  const intervalMs = Number(process.env.FINPROOF_REGULATORY_POLL_INTERVAL_MS ?? "86400000");
  const poller = createRegulatorySourcePoller({
    onChange: (info) =>
      console.log(`[regulatory-poll] CHANGE detected: ${info.name} (${info.changeSetCount} change-set)`)
  });

  let stop = false;
  process.once("SIGINT", () => {
    stop = true;
  });
  process.once("SIGTERM", () => {
    stop = true;
  });

  do {
    const summary = await poller.pollAll(reviewerContext());
    console.log(`[regulatory-poll] ${JSON.stringify(summary)}`);
    if (loop && !stop) {
      await sleep(Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 86_400_000);
    }
  } while (loop && !stop);
}

main().catch((error) => {
  console.error("[regulatory-poll] fatal:", error);
  process.exit(1);
});
