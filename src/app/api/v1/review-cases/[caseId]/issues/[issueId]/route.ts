import { NextResponse } from "next/server";
import type { ReviewIssue, RiskLevel } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

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

  let issue: ReviewIssue | undefined;

  try {
    issue = await createReviewService().saveIssueDecision(await requestContext(request), {
      reviewCaseId: caseId,
      issueId,
      reviewerRiskLevel: body.reviewerRiskLevel,
      finalAction: body.finalAction,
      reviewerComment: body.reviewerComment ?? ""
    });
  } catch (error) {
    return jsonForbidden(error);
  }

  if (!issue) {
    return jsonError("Issue not found", 404);
  }

  return NextResponse.json({ issue });
}
