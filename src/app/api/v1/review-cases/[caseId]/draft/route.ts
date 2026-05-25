import { NextResponse } from "next/server";
import { generateDraftWithChatContext, type ReviewChatResponse } from "@/domain/chat";
import { getReviewStore } from "@/server/reviews";
import { jsonError, readJsonBody, type RouteContext } from "@/server/reviews/route-utils";

type DraftRequest = {
  markedResponses?: ReviewChatResponse[];
};

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<DraftRequest>(request);
  const review = await getReviewStore().getReviewCase(caseId);

  if (!review) {
    return jsonError("Review case not found", 404);
  }

  const draft = generateDraftWithChatContext(review, body?.markedResponses ?? []);

  await getReviewStore().saveOpinionDraft(caseId, draft);

  return NextResponse.json({ draft });
}
