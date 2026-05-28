import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonRouteError,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type UpdateReviewCaseBody = {
  reviewer?: unknown;
};

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const reviewCase = await createReviewService().getReviewCase(
    await requestContext(request),
    caseId
  );

  if (!reviewCase) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({ reviewCase });
}

export async function PATCH(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<UpdateReviewCaseBody>(request);
  const reviewer = typeof body?.reviewer === "string" ? body.reviewer.trim() : "";

  if (!reviewer) {
    return jsonError("reviewer is required", 400, "VALIDATION_ERROR");
  }

  try {
    const reviewCase = await createReviewService().updateReviewReviewer(
      await requestContext(request),
      {
        reviewCaseId: caseId,
        reviewer
      }
    );

    if (!reviewCase) {
      return jsonError("Review case not found", 404);
    }

    return NextResponse.json({
      reviewCase: {
        id: reviewCase.id,
        reviewer: reviewCase.reviewer
      }
    });
  } catch (error) {
    return jsonRouteError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;

  try {
    const reviewCase = await createReviewService().deleteReviewHistory(
      await requestContext(request),
      caseId
    );

    if (!reviewCase) {
      return jsonError("Review case not found", 404);
    }

    return NextResponse.json({
      deleted: true,
      reviewCaseId: reviewCase.id
    });
  } catch (error) {
    return jsonRouteError(error);
  }
}
