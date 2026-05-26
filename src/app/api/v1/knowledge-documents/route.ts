import { NextResponse } from "next/server";
import type { KnowledgeDocumentType, ProductType } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  readJsonBody,
  requestContext
} from "@/server/reviews/route-utils";

type CreateKnowledgeDocumentBody = {
  documentType?: unknown;
  productType?: unknown;
  affiliateId?: unknown;
  title?: unknown;
  version?: unknown;
  effectiveFrom?: unknown;
  storageKey?: unknown;
};

export async function GET(request = new Request("http://localhost/api/v1/knowledge-documents")) {
  try {
    const documents = await createReviewService().listKnowledgeDocuments(
      await requestContext(request)
    );

    return NextResponse.json({ documents });
  } catch (error) {
    return jsonForbidden(error);
  }
}

export async function POST(request: Request) {
  const body = await readJsonBody<CreateKnowledgeDocumentBody>(request);
  const title = parseRequiredString(body?.title);
  const version = parseRequiredString(body?.version);
  const storageKey = parseRequiredString(body?.storageKey);
  const documentType = parseKnowledgeDocumentType(body?.documentType);
  const productType = parseProductType(body?.productType);
  const affiliateId = parseOptionalString(body?.affiliateId);
  const effectiveFrom =
    parseOptionalString(body?.effectiveFrom) ?? new Date().toISOString().slice(0, 10);

  if (!title) {
    return jsonError("title is required", 400);
  }

  if (!version) {
    return jsonError("version is required", 400);
  }

  if (!storageKey) {
    return jsonError("storageKey is required", 400);
  }

  if (!documentType) {
    return jsonError("documentType is invalid", 400);
  }

  if (body?.productType !== undefined && !productType) {
    return jsonError("productType is invalid", 400);
  }

  try {
    const document = await createReviewService().createKnowledgeDocument(
      await requestContext(request),
      {
        documentType,
        productType,
        affiliateId,
        title,
        version,
        effectiveFrom,
        storageKey
      }
    );

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return jsonForbidden(error);
  }
}

function parseRequiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseKnowledgeDocumentType(value: unknown): KnowledgeDocumentType | undefined {
  if (value === undefined) {
    return "internal_policy";
  }

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
    value === "investment"
  ) {
    return value;
  }

  return undefined;
}
