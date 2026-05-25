import { NextResponse } from "next/server";
import { getReviewStore } from "@/server/reviews";
import { jsonError, type RouteContext } from "@/server/reviews/route-utils";

export async function POST(_request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const result = await getReviewStore().startAnalysis(caseId);

  if (!result) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json(result);
}
