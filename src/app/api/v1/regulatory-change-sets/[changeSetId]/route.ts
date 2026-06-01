import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonRouteError,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

export async function GET(request: Request, context: RouteContext<{ changeSetId: string }>) {
  const { changeSetId } = await context.params;

  try {
    const service = createReviewService();
    const requestScope = await requestContext(request);
    const changeSet = await service.getRegulatoryChangeSet(requestScope, changeSetId);

    if (!changeSet) {
      return jsonError("Regulatory change set not found", 404, "NOT_FOUND");
    }

    const qualityGateResults = await service.listQualityGateResults(requestScope, changeSetId);

    return NextResponse.json({ changeSet, qualityGateResults: qualityGateResults ?? [] });
  } catch (error) {
    return jsonRouteError(error);
  }
}
