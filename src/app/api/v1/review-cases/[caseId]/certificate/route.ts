import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonRouteError,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type IssueCertificateRequest = {
  body?: string;
  certificateNumber?: string;
  validFrom?: string;
  validUntil?: string;
  remarks?: string;
};

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const payload = await readJsonBody<IssueCertificateRequest>(request);
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  const certificateNumber =
    typeof payload?.certificateNumber === "string" ? payload.certificateNumber.trim() : "";
  const validFrom =
    typeof payload?.validFrom === "string" ? payload.validFrom.trim() : "";
  const validUntil =
    typeof payload?.validUntil === "string" ? payload.validUntil.trim() : "";
  const remarks = typeof payload?.remarks === "string" ? payload.remarks.trim() : "";

  if (!body) {
    return jsonError("body is required", 400);
  }

  if (!certificateNumber) {
    return jsonError("certificateNumber is required", 400);
  }

  let certificate;

  try {
    certificate = await createReviewService().issueReviewCertificate(
      await requestContext(request),
      caseId,
      {
        body,
        certificateNumber,
        validFrom: validFrom || undefined,
        validUntil: validUntil || undefined,
        remarks: remarks || undefined
      }
    );
  } catch (error) {
    return jsonRouteError(error);
  }

  if (!certificate) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({ certificate });
}

// 승인 전 워크벤치에서 심의필 내용을 임시 저장한다. 심의필 번호는 발급 시점에 채워도 되므로 선택값.
export async function PUT(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const payload = await readJsonBody<IssueCertificateRequest>(request);
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  const certificateNumber =
    typeof payload?.certificateNumber === "string" ? payload.certificateNumber.trim() : "";
  const validFrom = typeof payload?.validFrom === "string" ? payload.validFrom.trim() : "";
  const validUntil = typeof payload?.validUntil === "string" ? payload.validUntil.trim() : "";
  const remarks = typeof payload?.remarks === "string" ? payload.remarks.trim() : "";

  if (!body) {
    return jsonError("body is required", 400);
  }

  let certificate;

  try {
    certificate = await createReviewService().saveReviewCertificateDraft(
      await requestContext(request),
      caseId,
      {
        body,
        certificateNumber,
        validFrom: validFrom || undefined,
        validUntil: validUntil || undefined,
        remarks: remarks || undefined
      }
    );
  } catch (error) {
    return jsonRouteError(error);
  }

  if (!certificate) {
    return jsonError("Review case not found", 404);
  }

  return NextResponse.json({ certificate });
}

export async function GET(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;

  let certificate;

  try {
    certificate = await createReviewService().getReviewCertificate(
      await requestContext(request),
      caseId
    );
  } catch (error) {
    return jsonRouteError(error);
  }

  if (!certificate) {
    return jsonError("Review certificate not found", 404);
  }

  return NextResponse.json({ certificate });
}
