import { NextResponse } from "next/server";
import type { ReportTone, ReportType } from "@/domain/reports";
import { generateReportWithModel } from "@/server/ai/review-ai-service";
import { requireRole } from "@/server/auth/rbac";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type GenerateReportRequest = {
  reportType?: ReportType;
  tone?: ReportTone;
  includeChatContext?: boolean;
  issueIds?: string[];
  draft?: string;
};

const reportTypes: ReportType[] = ["approve", "change_request", "reject", "hold"];
const reportTones: ReportTone[] = ["formal", "soft", "strict"];

function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && reportTypes.includes(value as ReportType);
}

function isReportTone(value: unknown): value is ReportTone {
  return typeof value === "string" && reportTones.includes(value as ReportTone);
}

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<GenerateReportRequest>(request);
  const contextValue = await requestContext(request);

  try {
    requireRole(contextValue, ["reviewer", "compliance_admin"], "generate report");
  } catch (error) {
    return jsonForbidden(error);
  }

  const review = await createReviewService().getReviewCase(contextValue, caseId);

  if (!review) {
    return jsonError("Review case not found", 404);
  }

  if (body?.reportType !== undefined && !isReportType(body.reportType)) {
    return jsonError("reportType must be one of approve, change_request, reject, hold", 400);
  }

  if (body?.tone !== undefined && !isReportTone(body.tone)) {
    return jsonError("tone must be one of formal, soft, strict", 400);
  }

  if (body?.draft !== undefined && typeof body.draft !== "string") {
    return jsonError("draft must be a string", 400);
  }

  if (body?.issueIds !== undefined && !Array.isArray(body.issueIds)) {
    return jsonError("issueIds must be an array of issue ids", 400);
  }

  const requestedIssueIds = body?.issueIds;

  if (requestedIssueIds?.some((issueId) => typeof issueId !== "string")) {
    return jsonError("issueIds must contain only strings", 400);
  }

  const knownIssueIds = new Set(review.issues.map((issue) => issue.id));
  const unknownIssueIds = requestedIssueIds?.filter((issueId) => !knownIssueIds.has(issueId)) ?? [];

  if (unknownIssueIds.length > 0) {
    return jsonError(`issueIds contains unknown issue ids: ${unknownIssueIds.join(", ")}`, 400);
  }

  const report = await generateReportWithModel({
    review,
    reportType: body?.reportType ?? "change_request",
    tone: body?.tone ?? "formal",
    includeChatContext: body?.includeChatContext ?? true,
    issueIds: requestedIssueIds ?? review.issues.map((issue) => issue.id),
    draft: body?.draft
  });

  return NextResponse.json(report);
}
