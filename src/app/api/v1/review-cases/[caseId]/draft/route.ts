import { NextResponse } from "next/server";
import { generateDraftWithChatContext, type ReviewChatResponse } from "@/domain/chat";
import { getReviewStore } from "@/server/reviews";
import { jsonError, readJsonBody, type RouteContext } from "@/server/reviews/route-utils";

type DraftRequest = {
  markedResponses?: ReviewChatResponse[];
};

type SaveDraftRequest = {
  draft?: unknown;
};

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<DraftRequest>(request);
  const review = await getReviewStore().getReviewCase(caseId);

  if (!review) {
    return jsonError("Review case not found", 404);
  }

  const draft = generateDraftWithChatContext(review, body?.markedResponses ?? []);

  const updatedReview = await getReviewStore().saveOpinionDraft(caseId, draft);

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

  const updatedReview = await getReviewStore().saveOpinionDraft(caseId, draft);

  if (!updatedReview) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({
    draft: updatedReview.currentDraft,
    version: updatedReview.currentDraftVersion
  });
}
