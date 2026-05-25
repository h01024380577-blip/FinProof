import { NextResponse } from "next/server";
import { getReviewStore } from "@/server/reviews";
import { jsonError, readJsonBody } from "@/server/reviews/route-utils";

type CreateReviewRequest = {
  samplePackageId?: string;
};

export async function GET() {
  const reviewCases = await getReviewStore().listReviewSummaries();

  return NextResponse.json({ reviewCases });
}

export async function POST(request: Request) {
  const body = await readJsonBody<CreateReviewRequest>(request);

  if (!body?.samplePackageId) {
    return jsonError("samplePackageId is required", 400);
  }

  const result = await getReviewStore().createReviewCaseFromSamplePackage({
    samplePackageId: body.samplePackageId
  });

  if (!result) {
    return jsonError("Sample package not found", 404);
  }

  return NextResponse.json(result, { status: 201 });
}
