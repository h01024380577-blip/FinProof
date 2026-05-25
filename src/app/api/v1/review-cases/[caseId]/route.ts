import { NextResponse } from "next/server";
import { getReviewStore } from "@/server/reviews";
import { jsonError, type RouteContext } from "@/server/reviews/route-utils";

export async function GET(_request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const reviewCase = await getReviewStore().getReviewCase(caseId);

  if (!reviewCase) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({ reviewCase });
}
