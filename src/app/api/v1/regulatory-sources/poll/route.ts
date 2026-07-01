import { NextResponse } from "next/server";
import { requireRole } from "@/server/auth/rbac";
import {
  createRegulatorySourcePoller,
  type PollSummary
} from "@/server/regulatory/regulatory-source-poller";
import { jsonRouteError, requestContext } from "@/server/reviews/route-utils";

// On-demand regulatory poll. The poll fetches current law text for every
// registered law document via korean-law-mcp (~2 MCP calls per document), which
// takes far longer than an nginx/proxy request timeout. So we start it in the
// background and return immediately; the client polls GET for the result summary.
// A module-level guard prevents overlapping runs. State is per-server-instance
// (in-memory) — sufficient for the single Next.js runtime.
type PollState = {
  status: "idle" | "running" | "done" | "error";
  summary?: PollSummary;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

let activePoll: Promise<unknown> | null = null;
let pollState: PollState = { status: "idle" };

export async function POST(request: Request) {
  try {
    const context = await requestContext(request);
    requireRole(context, ["reviewer", "compliance_admin"], "poll regulatory sources");

    const alreadyRunning = activePoll !== null;

    if (!activePoll) {
      const startedAt = new Date().toISOString();
      pollState = { status: "running", startedAt };
      activePoll = createRegulatorySourcePoller()
        .pollAll(context)
        .then((summary) => {
          pollState = { status: "done", summary, startedAt, finishedAt: new Date().toISOString() };
        })
        .catch((error) => {
          console.error("[regulatory-poll] on-demand poll failed:", error);
          pollState = {
            status: "error",
            error: (error as Error).message,
            startedAt,
            finishedAt: new Date().toISOString()
          };
        })
        .finally(() => {
          activePoll = null;
        });
    }

    return NextResponse.json({ started: true, alreadyRunning });
  } catch (error) {
    return jsonRouteError(error);
  }
}

export async function GET(request: Request) {
  try {
    const context = await requestContext(request);
    requireRole(context, ["reviewer", "compliance_admin"], "poll regulatory sources");

    return NextResponse.json({ running: activePoll !== null, state: pollState });
  } catch (error) {
    return jsonRouteError(error);
  }
}
