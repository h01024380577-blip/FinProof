import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, requestContext, type RouteContext } from "@/server/reviews/route-utils";

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const auditEvents = await createReviewService().listReviewCaseAuditEvents(
    await requestContext(request),
    caseId
  );

  if (!auditEvents) {
    return jsonError("Review case not found", 404, "NOT_FOUND");
  }

  return NextResponse.json({ auditEvents });
}
