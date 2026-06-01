import { NextResponse } from "next/server";
import type { RegulatorySource, RegulatorySourceType } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonRouteError,
  readJsonBody,
  requestContext
} from "@/server/reviews/route-utils";

type CreateSourceBody = {
  id?: unknown;
  sourceType?: unknown;
  name?: unknown;
  url?: unknown;
  repositoryPath?: unknown;
  pollingSchedule?: unknown;
  trustLevel?: unknown;
};

export async function GET(request = new Request("http://localhost/api/v1/regulatory-sources")) {
  try {
    const sources = await createReviewService().listRegulatorySources(
      await requestContext(request)
    );

    return NextResponse.json({ sources });
  } catch (error) {
    return jsonRouteError(error);
  }
}

export async function POST(request: Request) {
  const body = await readJsonBody<CreateSourceBody>(request);
  const sourceType = parseSourceType(body?.sourceType);
  const name = parseString(body?.name);
  const trustLevel = parseTrustLevel(body?.trustLevel);

  if (!sourceType) {
    return jsonError("sourceType is invalid", 400);
  }

  if (!name) {
    return jsonError("name is required", 400);
  }

  if (!trustLevel) {
    return jsonError("trustLevel is invalid", 400);
  }

  try {
    const source = await createReviewService().createRegulatorySource(
      await requestContext(request),
      {
        id: parseString(body?.id),
        sourceType,
        name,
        url: parseString(body?.url),
        repositoryPath: parseString(body?.repositoryPath),
        pollingSchedule: parseString(body?.pollingSchedule) ?? "0 9 * * *",
        trustLevel
      }
    );

    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    return jsonRouteError(error);
  }
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseSourceType(value: unknown): RegulatorySourceType | undefined {
  if (
    value === "regulator" ||
    value === "law_portal" ||
    value === "association" ||
    value === "internal_policy_repo" ||
    value === "case_knowledge"
  ) {
    return value;
  }

  return undefined;
}

function parseTrustLevel(value: unknown): RegulatorySource["trustLevel"] | undefined {
  if (
    value === "official" ||
    value === "industry" ||
    value === "internal" ||
    value === "reference"
  ) {
    return value;
  }

  return undefined;
}
