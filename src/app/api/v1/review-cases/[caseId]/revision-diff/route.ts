import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonRouteError, requestContext, type RouteContext } from "@/server/reviews/route-utils";

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;

  try {
    const requestCtx = await requestContext(request);
    const service = createReviewService();
    const result = await service.getRevisionDiff(requestCtx, caseId);

    return NextResponse.json(result);
  } catch (error) {
    return jsonRouteError(error);
  }
}
