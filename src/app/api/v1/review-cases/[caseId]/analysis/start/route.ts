import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  try {
    const { caseId } = await context.params;
    const result = await createReviewService().startAnalysis(await requestContext(request), caseId);

    if (!result) {
      return jsonError("Review case not found", 404, "NOT_FOUND");
    }

    return NextResponse.json(result);
  } catch (error) {
    return jsonForbidden(error);
  }
}
