import { NextResponse } from "next/server";
import type { ProductType, ReviewStatus } from "@/domain/types";
import { validateUploadedFiles } from "@/domain/upload-policy";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  parseOptionalQueryString,
  parsePageSizeQuery,
  parsePositiveIntegerQuery,
  parseRiskLevel,
  readJsonBody,
  requestContext,
  type QueryParseResult
} from "@/server/reviews/route-utils";
import { sampleDataEnabled } from "@/server/reviews/sample-data";
import { UnsafeArchiveError } from "@/server/storage/archive-extraction";
import { UnsafeUploadError } from "@/server/storage/upload-security";

type CreateReviewRequest = {
  samplePackageId?: string;
};

export async function GET(request = new Request("http://localhost/api/v1/review-cases")) {
  const url = new URL(request.url);
  const status = parseReviewStatus(url.searchParams.get("status"));
  const productType = parseProductTypeQuery(url.searchParams.get("productType"));
  const riskLevel = parseRiskLevelQuery(url.searchParams.get("riskLevel"));
  const page = parsePositiveIntegerQuery(url.searchParams.get("page"), "page", 1);
  const pageSize = parsePageSizeQuery(url.searchParams.get("pageSize"));

  if (!status.ok) {
    return jsonError(status.message, 400);
  }

  if (!productType.ok) {
    return jsonError(productType.message, 400);
  }

  if (!riskLevel.ok) {
    return jsonError(riskLevel.message, 400);
  }

  if (!page.ok) {
    return jsonError(page.message, 400);
  }

  if (!pageSize.ok) {
    return jsonError(pageSize.message, 400);
  }

  const reviewCases = await createReviewService().listReviewSummaries(
    await requestContext(request),
    {
      status: status.value,
      productType: productType.value,
      affiliateId: parseOptionalQueryString(url.searchParams.get("affiliateId")),
      riskLevel: riskLevel.value,
      page: page.value,
      pageSize: pageSize.value
    }
  );

  return NextResponse.json(reviewCases);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    return createFromMultipart(request);
  }

  const body = await readJsonBody<CreateReviewRequest>(request);

  if (!sampleDataEnabled()) {
    return jsonError("Only multipart package uploads are accepted", 415, "MULTIPART_REQUIRED");
  }

  if (!body?.samplePackageId) {
    return jsonError("samplePackageId is required", 400);
  }

  const result = await createReviewService().createReviewCaseFromSamplePackage(
    await requestContext(request),
    {
      samplePackageId: body.samplePackageId
    }
  );

  if (!result) {
    return jsonError("Sample package not found", 404);
  }

  return NextResponse.json(result, { status: 201 });
}

function parseProductType(value: FormDataEntryValue | string | null): ProductType | undefined {
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

function parseProductTypeQuery(value: string | null): QueryParseResult<ProductType> {
  const trimmed = parseOptionalQueryString(value);

  if (!trimmed) {
    return { ok: true, value: undefined };
  }

  const productType = parseProductType(trimmed);

  return productType
    ? { ok: true, value: productType }
    : { ok: false, message: "productType is invalid" };
}

function parseRiskLevelQuery(
  value: string | null
): QueryParseResult<ReturnType<typeof parseRiskLevel>> {
  const trimmed = parseOptionalQueryString(value);

  if (!trimmed) {
    return { ok: true, value: undefined };
  }

  const riskLevel = parseRiskLevel(trimmed);

  return riskLevel
    ? { ok: true, value: riskLevel }
    : { ok: false, message: "riskLevel is invalid" };
}

function parseReviewStatus(value: string | null): QueryParseResult<ReviewStatus> {
  const trimmed = parseOptionalQueryString(value);

  if (!trimmed) {
    return { ok: true, value: undefined };
  }

  if (
    trimmed === "draft" ||
    trimmed === "submitted" ||
    trimmed === "parsing" ||
    trimmed === "analysis_waiting" ||
    trimmed === "analysis_queued" ||
    trimmed === "analysis_in_progress" ||
    trimmed === "analysis_complete" ||
    trimmed === "under_review" ||
    trimmed === "change_requested" ||
    trimmed === "rejected" ||
    trimmed === "approved" ||
    trimmed === "on_hold" ||
    trimmed === "archived"
  ) {
    return { ok: true, value: trimmed };
  }

  return { ok: false, message: "status is invalid" };
}

function readString(formData: FormData, key: string, fallback = ""): string {
  const value = formData.get(key);

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return (
    typeof value !== "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "size" in value &&
    typeof value.size === "number" &&
    value.size > 0
  );
}

async function createFromMultipart(request: Request) {
  const formData = await request.formData();
  const productType = parseProductType(formData.get("productType"));
  const uploadedFiles = formData.getAll("files").filter(isUploadedFile);
  const filesForValidation = uploadedFiles.map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size
  }));
  const files = await Promise.all(
    uploadedFiles.map(async (file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      body: new Uint8Array(await file.arrayBuffer())
    }))
  );

  if (!productType) {
    return jsonError("productType is required", 400);
  }

  if (uploadedFiles.length === 0) {
    return jsonError("At least one file is required", 400);
  }

  const validation = validateUploadedFiles(filesForValidation);

  if (!validation.ok) {
    return jsonError(validation.errors.join(" "), 400);
  }

  const channelType = formData
    .getAll("channelType")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  let result;

  try {
    result = await createReviewService().createReviewCaseFromUploadedFiles(
      await requestContext(request),
      {
        title: readString(formData, "title", "실제 업로드 심의 요청"),
        affiliate: readString(formData, "affiliate", "광주은행"),
        requestDepartment: readString(formData, "requestDepartment"),
        productType,
        channelType: channelType.length > 0 ? channelType : ["poster"],
        plannedPublishDate: readString(formData, "plannedPublishDate", "2026-06-20"),
        files
      }
    );
  } catch (error) {
    if (error instanceof UnsafeUploadError) {
      return jsonError(error.message, 400, "UNSAFE_UPLOAD");
    }

    if (error instanceof UnsafeArchiveError) {
      return jsonError(error.message, 400, "UNSAFE_ARCHIVE");
    }

    throw error;
  }

  return NextResponse.json(result, { status: 201 });
}
