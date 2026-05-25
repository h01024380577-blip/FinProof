import { NextResponse } from "next/server";
import type { ReviewIssue } from "@/domain/types";
import { getReviewStore } from "@/server/reviews";
import type { FinalReviewStatus } from "@/server/reviews/review-store";
import { jsonError, readJsonBody, type RouteContext } from "@/server/reviews/route-utils";

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
  const reviewCase = await getReviewStore().updateReviewStatus(caseId, status);

  if (!reviewCase) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({
    finalAction: body.finalAction,
    reviewCase
  });
}
