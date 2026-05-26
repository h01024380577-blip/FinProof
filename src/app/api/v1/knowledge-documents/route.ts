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

type UploadedKnowledgeFile = {
  name: string;
  type: string;
  size: number;
  body: Uint8Array;
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
  if (request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    return postMultipart(request);
  }

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
    const result = await createReviewService().createKnowledgeDocument(
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

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonForbidden(error);
  }
}

async function postMultipart(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonError("multipart form data is invalid", 400);
  }

  const title = parseRequiredString(formData.get("title"));
  const version = parseRequiredString(formData.get("version"));
  const documentType = parseKnowledgeDocumentType(formData.get("documentType"));
  const productType = parseProductType(formData.get("productType"));
  const affiliateId = parseOptionalString(formData.get("affiliateId"));
  const effectiveFrom =
    parseOptionalString(formData.get("effectiveFrom")) ?? new Date().toISOString().slice(0, 10);
  const uploadedFile = await parseUploadedFile(formData.get("file"));

  if (!title) {
    return jsonError("title is required", 400);
  }

  if (!version) {
    return jsonError("version is required", 400);
  }

  if (!documentType) {
    return jsonError("documentType is invalid", 400);
  }

  if (formData.has("productType") && !productType) {
    return jsonError("productType is invalid", 400);
  }

  if (!uploadedFile) {
    return jsonError("file is required", 400);
  }

  try {
    const result = await createReviewService().createKnowledgeDocument(
      await requestContext(request),
      {
        documentType,
        productType,
        affiliateId,
        title,
        version,
        effectiveFrom,
        file: uploadedFile
      }
    );

    return NextResponse.json(result, { status: 201 });
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

function isFileLike(value: unknown): value is File {
  return (
    typeof File !== "undefined" &&
    value instanceof File &&
    typeof value.name === "string" &&
    value.size > 0
  );
}

async function parseUploadedFile(
  value: FormDataEntryValue | null
): Promise<UploadedKnowledgeFile | undefined> {
  if (!isFileLike(value)) {
    return undefined;
  }

  return {
    name: value.name,
    type: value.type || "application/octet-stream",
    size: value.size,
    body: new Uint8Array(await value.arrayBuffer())
  };
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
