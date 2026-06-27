import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonRouteError,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;

  try {
    const requestCtx = await requestContext(request);
    const service = createReviewService();
    const [reviewCase, versions] = await Promise.all([
      service.getReviewCase(requestCtx, caseId),
      service.listReviewVersions(requestCtx, caseId)
    ]);

    if (!reviewCase) {
      return jsonError("Review case not found", 404);
    }

    return NextResponse.json({ currentVersion: reviewCase.currentVersion, versions });
  } catch (error) {
    return jsonRouteError(error);
  }
}
