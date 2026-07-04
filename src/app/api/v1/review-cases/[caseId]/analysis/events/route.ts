import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, requestContext, type RouteContext } from "@/server/reviews/route-utils";

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const sinceParam = new URL(request.url).searchParams.get("since");
  const sinceValue = sinceParam !== null ? Number(sinceParam) : Number.NaN;
  const since = Number.isFinite(sinceValue) ? sinceValue : undefined;

  const result = await createReviewService().listAnalysisEvents(
    await requestContext(request),
    caseId,
    { since }
  );

  if (!result) {
    return jsonError("Review case not found", 404, "NOT_FOUND");
  }

  return NextResponse.json(result);
}
