import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type MarkForDraftBody = {
  markedForDraft?: unknown;
};

export async function POST(request: Request, context: RouteContext<{ messageId: string }>) {
  const { messageId } = await context.params;
  const body = await readJsonBody<MarkForDraftBody>(request);

  if (typeof body?.markedForDraft !== "boolean") {
    return jsonError("markedForDraft is required", 400);
  }

  try {
    const message = await createReviewService().markChatMessageForDraft(
      await requestContext(request),
      messageId,
      body.markedForDraft
    );

    if (!message) {
      return jsonError("Chat message not found", 404, "NOT_FOUND");
    }

    return NextResponse.json({ message });
  } catch (error) {
    return jsonForbidden(error);
  }
}
