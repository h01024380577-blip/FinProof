import { NextResponse } from "next/server";
import { answerReviewQuestionWithModel } from "@/server/ai/review-ai-service";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type ChatRequest = {
  issueId?: string;
  question?: string;
};

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<ChatRequest>(request);

  if (!body?.issueId || !body.question) {
    return jsonError("issueId and question are required", 400);
  }

  const service = createReviewService();
  const contextValue = await requestContext(request);
  const review = await service.getReviewCase(contextValue, caseId);
  const issue = await service.getIssue(contextValue, caseId, body.issueId);

  if (!review || !issue) {
    return jsonError("Review case or issue not found", 404);
  }

  const response = await answerReviewQuestionWithModel({
    review,
    issue,
    question: body.question
  });

  return NextResponse.json({ response });
}
