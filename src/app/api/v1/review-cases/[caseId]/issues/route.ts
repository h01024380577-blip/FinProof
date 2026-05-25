import { NextResponse } from "next/server";
import { getReviewStore } from "@/server/reviews";
import { jsonError, parseRiskLevel, type RouteContext } from "@/server/reviews/route-utils";

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const riskLevel = parseRiskLevel(new URL(request.url).searchParams.get("riskLevel"));
  const issues = await getReviewStore().listIssues(caseId, { riskLevel });

  if (!issues) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({ issues });
}
