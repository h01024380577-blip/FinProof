import { NextResponse } from "next/server";
import type { ReviewChatResponse } from "@/domain/chat";
import { generateDraftWithModel } from "@/server/ai/review-ai-service";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type DraftRequest = {
  chatResponses?: ReviewChatResponse[];
  markedResponses?: ReviewChatResponse[];
  selectedIssueIds?: string[];
};

type SaveDraftRequest = {
  draft?: unknown;
};

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<DraftRequest>(request);
  const service = createReviewService();
  const contextValue = await requestContext(request);
  const review = await service.getReviewCase(contextValue, caseId);

  if (!review) {
    return jsonError("Review case not found", 404);
  }

  const chatResponses = body?.chatResponses ?? body?.markedResponses ?? [];
  const selectedIssueIds = Array.isArray(body?.selectedIssueIds)
    ? body.selectedIssueIds.filter((id): id is string => typeof id === "string")
    : undefined;
  const draft = await generateDraftWithModel(review, chatResponses, undefined, selectedIssueIds);
  let updatedReview;

  try {
    updatedReview = await service.saveOpinionDraft(contextValue, caseId, draft);
  } catch (error) {
    return jsonForbidden(error);
  }

  return NextResponse.json({ draft, version: updatedReview?.currentDraftVersion });
}

export async function PATCH(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<SaveDraftRequest>(request);

  if (typeof body?.draft !== "string") {
    return jsonError("draft is required", 400);
  }

  const draft = body.draft.trim();

  if (!draft) {
    return jsonError("draft is required", 400);
  }

  let updatedReview;

  try {
    updatedReview = await createReviewService().saveOpinionDraft(
      await requestContext(request),
      caseId,
      draft
    );
  } catch (error) {
    return jsonForbidden(error);
  }

  if (!updatedReview) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({
    draft: updatedReview.currentDraft,
    version: updatedReview.currentDraftVersion
  });
}
