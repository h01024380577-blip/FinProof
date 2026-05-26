import { NextResponse } from "next/server";
import type { DraftVersion } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type CreateDraftVersionBody = {
  draft?: unknown;
  source?: unknown;
  sourceMessageIds?: unknown;
  evidenceIds?: unknown;
};

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<CreateDraftVersionBody>(request);
  const source = parseDraftSource(body?.source);

  if (!source) {
    return jsonError("source is invalid", 400);
  }

  const sourceMessageIds = parseStringArray(body?.sourceMessageIds);
  const evidenceIds = parseStringArray(body?.evidenceIds);

  if (body?.sourceMessageIds !== undefined && !sourceMessageIds) {
    return jsonError("sourceMessageIds must be an array of strings", 400);
  }

  if (body?.evidenceIds !== undefined && !evidenceIds) {
    return jsonError("evidenceIds must be an array of strings", 400);
  }

  try {
    const draftVersion = await createReviewService().createDraftVersion(
      await requestContext(request),
      caseId,
      {
        draft: parseOptionalString(body?.draft),
        source,
        sourceMessageIds,
        evidenceIds
      }
    );

    if (!draftVersion) {
      return jsonError("Review case not found", 404, "NOT_FOUND");
    }

    return NextResponse.json({ draftVersion }, { status: 201 });
  } catch (error) {
    return jsonForbidden(error);
  }
}

function parseDraftSource(value: unknown): DraftVersion["source"] | undefined {
  if (value === undefined) {
    return "generated";
  }

  if (value === "generated" || value === "manual" || value === "fallback") {
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
