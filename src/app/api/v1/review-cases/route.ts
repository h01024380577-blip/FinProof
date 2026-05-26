import { NextResponse } from "next/server";
import type { ProductType } from "@/domain/types";
import { validateUploadedFiles } from "@/domain/upload-policy";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, readJsonBody, requestContext } from "@/server/reviews/route-utils";
import { UnsafeArchiveError } from "@/server/storage/archive-extraction";
import { UnsafeUploadError } from "@/server/storage/upload-security";

type CreateReviewRequest = {
  samplePackageId?: string;
};

export async function GET(request = new Request("http://localhost/api/v1/review-cases")) {
  const reviewCases = await createReviewService().listReviewSummaries(
    await requestContext(request)
  );

  return NextResponse.json({ reviewCases });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    return createFromMultipart(request);
  }

  const body = await readJsonBody<CreateReviewRequest>(request);

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

function parseProductType(value: FormDataEntryValue | null): ProductType | undefined {
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
