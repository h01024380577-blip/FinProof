import { NextResponse } from "next/server";
import { getReviewStore } from "@/server/reviews";
import { jsonError, type RouteContext } from "@/server/reviews/route-utils";

export async function GET(_request: Request, context: RouteContext<{ issueId: string }>) {
  const { issueId } = await context.params;
  const evidence = await getReviewStore().getIssueEvidence(issueId);

  if (!evidence) {
    return jsonError("Issue not found", 404);
  }

  return NextResponse.json({ evidence });
}
