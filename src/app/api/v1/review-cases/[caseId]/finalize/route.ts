import { NextResponse } from "next/server";
import type { ReviewIssue } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import type { FinalReviewStatus } from "@/server/reviews/review-store";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type FinalReviewAction = NonNullable<ReviewIssue["finalAction"]>;

type FinalizeReviewCaseBody = {
  finalAction?: FinalReviewAction;
  reviewerComment?: string;
  reportId?: string;
};

const finalActionStatusMap: Record<FinalReviewAction, FinalReviewStatus> = {
  approve: "approved",
  change_request: "change_requested",
  reject: "rejected",
  hold: "on_hold"
};

const finalReviewActions = Object.keys(finalActionStatusMap) as FinalReviewAction[];

function isFinalReviewAction(value: unknown): value is FinalReviewAction {
  return typeof value === "string" && finalReviewActions.includes(value as FinalReviewAction);
}

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<FinalizeReviewCaseBody>(request);

  if (!isFinalReviewAction(body?.finalAction)) {
    return jsonError("finalAction is required for review finalization", 400);
  }

  const status = finalActionStatusMap[body.finalAction];
  let reviewCase;

  try {
    reviewCase = await createReviewService().updateReviewStatus(
      await requestContext(request),
      caseId,
      status,
      typeof body?.reviewerComment === "string" ? { reviewerComment: body.reviewerComment } : {}
    );
  } catch (error) {
    return jsonForbidden(error);
  }

  if (!reviewCase) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({
    finalAction: body.finalAction,
    reviewCase
  });
}
