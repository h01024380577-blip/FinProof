import { pathToFileURL } from "node:url";
import { createAnalysisWorker } from "@/server/analysis/analysis-worker";
import { loadDotEnv } from "./load-env";

const DEFAULT_POLL_INTERVAL_MS = 5000;

type AnalysisWorkerCliOptions = {
  loop: boolean;
  pollIntervalMs: number;
};

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInteger(value: string | undefined) {
  const parsed = value ? Number(value) : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseAnalysisWorkerCliArgs(argv: string[]): AnalysisWorkerCliOptions {
  const pollArg = argv.find((arg) => arg.startsWith("--poll-ms="));

  return {
    loop: argv.includes("--loop"),
    pollIntervalMs: positiveInteger(pollArg?.split("=", 2)[1]) ?? DEFAULT_POLL_INTERVAL_MS
  };
}

async function runWorkerLoop({
  tenantId,
  workerId,
  pollIntervalMs
}: {
  tenantId: string;
  workerId: string;
  pollIntervalMs: number;
}) {
  let shouldStop = false;
  const worker = createAnalysisWorker();
  const stop = () => {
    shouldStop = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!shouldStop) {
    const result = await worker.runOnce({ tenantId, workerId });
    console.log(JSON.stringify({ ...result, checkedAt: new Date().toISOString() }, null, 2));

    if (!result.processed) {
      await sleep(pollIntervalMs);
    }
  }
}

async function main() {
  loadDotEnv();

  const options = parseAnalysisWorkerCliArgs(process.argv.slice(2));
  const tenantId = process.env.FINPROOF_WORKER_TENANT_ID ?? process.env.FINPROOF_DEFAULT_TENANT_ID;
  const workerId = process.env.FINPROOF_ANALYSIS_WORKER_ID ?? "finproof-analysis-worker";

  if (!tenantId) {
    console.error("FINPROOF_WORKER_TENANT_ID or FINPROOF_DEFAULT_TENANT_ID is required.");
    process.exit(1);
  }

  if (options.loop) {
    await runWorkerLoop({ tenantId, workerId, pollIntervalMs: options.pollIntervalMs });
    return;
  }

  const result = await createAnalysisWorker().runOnce({ tenantId, workerId });

  console.log(JSON.stringify(result, null, 2));
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
