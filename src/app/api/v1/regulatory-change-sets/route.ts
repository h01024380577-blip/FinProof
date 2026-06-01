import { NextResponse } from "next/server";
import type { QualityGateStatus } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, jsonRouteError, requestContext } from "@/server/reviews/route-utils";

export async function GET(request = new Request("http://localhost/api/v1/regulatory-change-sets")) {
  const url = new URL(request.url);
  const qualityGateStatus = parseQualityGateStatus(url.searchParams.get("qualityGateStatus"));

  if (url.searchParams.has("qualityGateStatus") && !qualityGateStatus) {
    return jsonError("qualityGateStatus is invalid", 400);
  }

  try {
    const changeSets = await createReviewService().listRegulatoryChangeSets(
      await requestContext(request),
      {
        sourceId: parseOptionalString(url.searchParams.get("sourceId")),
        qualityGateStatus
      }
    );

    return NextResponse.json({ changeSets });
  } catch (error) {
    return jsonRouteError(error);
  }
}

function parseOptionalString(value: string | null): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function parseQualityGateStatus(value: string | null): QualityGateStatus | undefined {
  if (value === "passed" || value === "failed" || value === "flagged") {
    return value;
  }

  return undefined;
}
