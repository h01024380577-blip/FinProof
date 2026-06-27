import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonRouteError,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";
import { UnsafeArchiveError } from "@/server/storage/archive-extraction";
import { UnsafeUploadError } from "@/server/storage/upload-security";

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

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const formData = await request.formData();
  const uploadedFiles = formData.getAll("files").filter(isUploadedFile);

  if (uploadedFiles.length === 0) {
    return jsonError("At least one file is required", 400);
  }

  const files = await Promise.all(
    uploadedFiles.map(async (file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      body: new Uint8Array(await file.arrayBuffer())
    }))
  );

  let reviewCase;

  try {
    reviewCase = await createReviewService().createReviewCaseRevision(
      await requestContext(request),
      caseId,
      { files }
    );
  } catch (error) {
    if (error instanceof UnsafeUploadError) {
      return jsonError(error.message, 400, "UNSAFE_UPLOAD");
    }

    if (error instanceof UnsafeArchiveError) {
      return jsonError(error.message, 400, "UNSAFE_ARCHIVE");
    }

    return jsonRouteError(error);
  }

  if (!reviewCase) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json(
    {
      reviewCase,
      analysisStartHref: `/api/v1/review-cases/${reviewCase.id}/analysis/start`
    },
    { status: 201 }
  );
}
