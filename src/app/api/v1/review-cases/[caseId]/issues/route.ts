import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  parseRiskLevel,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const riskLevel = parseRiskLevel(new URL(request.url).searchParams.get("riskLevel"));
  const issues = await createReviewService().listIssues(await requestContext(request), caseId, {
    riskLevel
  });

  if (!issues) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({ issues });
}
