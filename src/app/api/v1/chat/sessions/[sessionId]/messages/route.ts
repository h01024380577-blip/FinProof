import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type CreateChatMessageBody = {
  content?: unknown;
};

export async function POST(request: Request, context: RouteContext<{ sessionId: string }>) {
  const { sessionId } = await context.params;
  const body = await readJsonBody<CreateChatMessageBody>(request);
  const content = typeof body?.content === "string" ? body.content.trim() : "";

  if (!content) {
    return jsonError("content is required", 400);
  }

  try {
    const result = await createReviewService().createChatMessage(await requestContext(request), {
      sessionId,
      content
    });

    if (!result) {
      return jsonError("Chat session not found", 404, "NOT_FOUND");
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonForbidden(error);
  }
}
