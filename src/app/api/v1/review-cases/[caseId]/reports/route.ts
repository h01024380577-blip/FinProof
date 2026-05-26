import { NextResponse } from "next/server";
import type { PersistedReviewReport } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type ReportTone = "formal" | "soft" | "strict";

type CreateReviewReportBody = {
  reportType?: unknown;
  tone?: unknown;
  includeChatContext?: unknown;
  issueIds?: unknown;
  draft?: unknown;
};

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<CreateReviewReportBody>(request);
  const reportType = parseReportType(body?.reportType);
  const tone = parseTone(body?.tone);
  const issueIds = parseStringArray(body?.issueIds);

  if (!reportType) {
    return jsonError("reportType is invalid", 400);
  }

  if (!tone) {
    return jsonError("tone is invalid", 400);
  }

  if (body?.issueIds !== undefined && !issueIds) {
    return jsonError("issueIds must be an array of strings", 400);
  }

  try {
    const report = await createReviewService().createReviewReport(
      await requestContext(request),
      caseId,
      {
        reportType,
        tone,
        includeChatContext:
          typeof body?.includeChatContext === "boolean" ? body.includeChatContext : true,
        issueIds: issueIds ?? [],
        draft: parseOptionalString(body?.draft)
      }
    );

    if (!report) {
      return jsonError("Review case not found", 404, "NOT_FOUND");
    }

    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return jsonForbidden(error);
  }
}

function parseReportType(value: unknown): PersistedReviewReport["reportType"] | undefined {
  if (value === undefined) {
    return "change_request";
  }

  if (value === "approve" || value === "change_request" || value === "reject" || value === "hold") {
    return value;
  }

  return undefined;
}

function parseTone(value: unknown): ReportTone | undefined {
  if (value === undefined) {
    return "formal";
  }

  if (value === "formal" || value === "soft" || value === "strict") {
    return value;
  }

  return undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (value.every((item) => typeof item === "string")) {
    return value;
  }

  return undefined;
}
