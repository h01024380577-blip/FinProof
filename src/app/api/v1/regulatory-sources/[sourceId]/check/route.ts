import { NextResponse } from "next/server";
import type { KnowledgeDocumentType, ProductType } from "@/domain/types";
import { requireRole } from "@/server/auth/rbac";
import {
  createRegulatoryKnowledgeService,
  RegulatorySourceCheckInputError,
  RegulatorySourceNotFoundError
} from "@/server/regulatory/regulatory-knowledge-service";
import {
  jsonError,
  jsonRouteError,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type CheckSourceBody = {
  title?: unknown;
  version?: unknown;
  sourceText?: unknown;
  previousNormalizedText?: unknown;
  previousContentHash?: unknown;
  effectiveFrom?: unknown;
  documentType?: unknown;
  productType?: unknown;
  mappedChannels?: unknown;
  mappedReviewCategories?: unknown;
};

export async function POST(request: Request, context: RouteContext<{ sourceId: string }>) {
  const { sourceId } = await context.params;
  const body = await readJsonBody<CheckSourceBody>(request);
  const title = parseString(body?.title);
  const version = parseString(body?.version);
  const sourceText = parseString(body?.sourceText);
  const documentType = parseDocumentType(body?.documentType);
  const productType = parseProductType(body?.productType);
  const mappedChannels = parseStringArray(body?.mappedChannels);
  const mappedReviewCategories = parseStringArray(body?.mappedReviewCategories);

  if (!title) {
    return jsonError("title is required", 400);
  }

  if (!version) {
    return jsonError("version is required", 400);
  }

  if (!sourceText) {
    return jsonError("sourceText is required", 400);
  }

  if (!documentType) {
    return jsonError("documentType is invalid", 400);
  }

  if (body?.productType !== undefined && !productType) {
    return jsonError("productType is invalid", 400);
  }

  if (body?.mappedChannels !== undefined && !mappedChannels) {
    return jsonError("mappedChannels must be an array of strings", 400);
  }

  if (body?.mappedReviewCategories !== undefined && !mappedReviewCategories) {
    return jsonError("mappedReviewCategories must be an array of strings", 400);
  }

  try {
    const context = await requestContext(request);

    requireRole(context, ["reviewer", "compliance_admin"], "check regulatory source");

    const result = await createRegulatoryKnowledgeService().runSourceCheck(context, {
      sourceId,
      title,
      version,
      sourceText,
      previousNormalizedText: parseString(body?.previousNormalizedText),
      previousContentHash: parseString(body?.previousContentHash),
      effectiveFrom: parseString(body?.effectiveFrom),
      documentType,
      productType,
      mappedChannels,
      mappedReviewCategories
    });

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof RegulatorySourceNotFoundError) {
      return jsonError(error.message, 404, "NOT_FOUND");
    }

    if (error instanceof RegulatorySourceCheckInputError) {
      return jsonError(error.message, 400, "INVALID_SOURCE_CHECK_INPUT");
    }

    return jsonRouteError(error);
  }
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value.map((item) => (typeof item === "string" ? item.trim() : ""));

  return parsed.length === value.length && parsed.every((item) => item.length > 0)
    ? parsed
    : undefined;
}

function parseDocumentType(value: unknown): KnowledgeDocumentType | undefined {
  if (
    value === "law" ||
    value === "internal_policy" ||
    value === "checklist" ||
    value === "guide"
  ) {
    return value;
  }

  return undefined;
}

function parseProductType(value: unknown): ProductType | undefined {
  if (
    value === "deposit" ||
    value === "loan" ||
    value === "card" ||
    value === "capital" ||
    value === "insurance" ||
    value === "investment" ||
    value === "image_test"
  ) {
    return value;
  }

  return undefined;
}
