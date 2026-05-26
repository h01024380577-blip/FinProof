import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, requestContext, type RouteContext } from "@/server/reviews/route-utils";

export async function GET(request: Request, context: RouteContext<{ issueId: string }>) {
  const { issueId } = await context.params;
  const evidence = await createReviewService().getIssueEvidence(
    await requestContext(request),
    issueId
  );

  if (!evidence) {
    return jsonError("Issue not found", 404);
  }

  return NextResponse.json({ evidence });
}
