import { NextResponse } from "next/server";
import type { ReviewIssue } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import type { CreateManualIssueInput } from "@/server/reviews/review-store";
import {
  jsonError,
  jsonRouteError,
  parseRiskLevel,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type CreateManualIssueRequest = {
  issueType?: string;
  riskLevel?: string;
  title?: string;
  targetText?: string;
  description?: string;
  suggestedAction?: string;
  suggestedCopy?: string;
};

const suggestedActions: ReviewIssue["suggestedAction"][] = [
  "approve",
  "change_request",
  "reject",
  "hold"
];

function isSuggestedAction(value: unknown): value is ReviewIssue["suggestedAction"] {
  return typeof value === "string" && suggestedActions.includes(value as ReviewIssue["suggestedAction"]);
}

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const riskLevel = parseRiskLevel(new URL(request.url).searchParams.get("riskLevel"));
  const issues = await createReviewService().listIssues(await requestContext(request), caseId, {
    riskLevel
  });

  if (!issues) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({ issues });
}

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<CreateManualIssueRequest>(request);

  const title = typeof body?.title === "string" ? body.title.trim() : "";

  if (!title) {
    return jsonError("title is required", 400);
  }

  const riskLevel = parseRiskLevel(body?.riskLevel ?? null);

  if (!riskLevel) {
    return jsonError("riskLevel is invalid", 400);
  }

  if (!isSuggestedAction(body?.suggestedAction)) {
    return jsonError("suggestedAction is invalid", 400);
  }

  const input: CreateManualIssueInput = {
    riskLevel,
    title,
    suggestedAction: body.suggestedAction,
    issueType: typeof body?.issueType === "string" ? body.issueType : undefined,
    targetText: typeof body?.targetText === "string" ? body.targetText : undefined,
    description: typeof body?.description === "string" ? body.description : undefined,
    suggestedCopy: typeof body?.suggestedCopy === "string" ? body.suggestedCopy : undefined
  };

  let issue;

  try {
    issue = await createReviewService().createManualIssue(
      await requestContext(request),
      caseId,
      input
    );
  } catch (error) {
    return jsonRouteError(error);
  }

  if (!issue) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({ issue }, { status: 201 });
}
