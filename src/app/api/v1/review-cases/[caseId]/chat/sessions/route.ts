import { NextResponse } from "next/server";
import type { ChatMode } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type CreateChatSessionBody = {
  mode?: unknown;
  issueId?: unknown;
};

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<CreateChatSessionBody>(request);
  const mode = parseChatMode(body?.mode);
  const issueId = parseOptionalString(body?.issueId);

  if (!mode) {
    return jsonError("mode is required", 400);
  }

  try {
    const session = await createReviewService().createChatSession(await requestContext(request), {
      reviewCaseId: caseId,
      issueId,
      mode
    });

    if (!session) {
      return jsonError("Review case not found", 404, "NOT_FOUND");
    }

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return jsonForbidden(error);
  }
}

function parseChatMode(value: unknown): ChatMode | undefined {
  if (value === "issue" || value === "case" || value === "similar_case" || value === "draft") {
    return value;
  }

  return undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
