import { NextResponse } from "next/server";
import { requireRole } from "@/server/auth/rbac";
import { createRegulatorySourcePoller } from "@/server/regulatory/regulatory-source-poller";
import { jsonRouteError, requestContext } from "@/server/reviews/route-utils";

// On-demand regulatory poll. The poll fetches current law text for every
// registered law document via korean-law-mcp (~2 MCP calls per document), which
// takes far longer than an nginx/proxy request timeout. So we start it in the
// background and return immediately; detected changes surface as RegulatoryChangeSet
// rows and in-app notifications. A module-level guard prevents overlapping runs.
let activePoll: Promise<unknown> | null = null;

export async function POST(request: Request) {
  try {
    const context = await requestContext(request);
    requireRole(context, ["reviewer", "compliance_admin"], "poll regulatory sources");

    const alreadyRunning = activePoll !== null;

    if (!activePoll) {
      activePoll = createRegulatorySourcePoller()
        .pollAll(context)
        .catch((error) => {
          console.error("[regulatory-poll] on-demand poll failed:", error);
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
