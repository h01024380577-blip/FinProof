import { NextResponse } from "next/server";
import { answerReviewQuestion } from "@/domain/chat";
import { getReviewStore } from "@/server/reviews";
import { jsonError, readJsonBody, type RouteContext } from "@/server/reviews/route-utils";

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

  const review = await getReviewStore().getReviewCase(caseId);
  const issue = await getReviewStore().getIssue(caseId, body.issueId);

  if (!review || !issue) {
    return jsonError("Review case or issue not found", 404);
  }

  const response = answerReviewQuestion({
    review,
    issue,
    question: body.question
  });

  return NextResponse.json({ response });
}
