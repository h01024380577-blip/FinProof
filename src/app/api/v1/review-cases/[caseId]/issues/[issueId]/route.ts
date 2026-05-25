import { NextResponse } from "next/server";
import type { ReviewIssue, RiskLevel } from "@/domain/types";
import { getReviewStore } from "@/server/reviews";
import { jsonError, readJsonBody, type RouteContext } from "@/server/reviews/route-utils";

type SaveDecisionRequest = {
  reviewerRiskLevel?: RiskLevel;
  finalAction?: ReviewIssue["finalAction"];
  reviewerComment?: string;
};

export async function PATCH(
  request: Request,
  context: RouteContext<{ caseId: string; issueId: string }>
) {
  const { caseId, issueId } = await context.params;
  const body = await readJsonBody<SaveDecisionRequest>(request);

  if (!body?.reviewerRiskLevel || !body.finalAction) {
    return jsonError("reviewerRiskLevel and finalAction are required", 400);
  }

  const issue = await getReviewStore().saveIssueDecision({
    reviewCaseId: caseId,
    issueId,
    reviewerRiskLevel: body.reviewerRiskLevel,
    finalAction: body.finalAction,
    reviewerComment: body.reviewerComment ?? ""
  });

  if (!issue) {
    return jsonError("Issue not found", 404);
  }

  return NextResponse.json({ issue });
}
