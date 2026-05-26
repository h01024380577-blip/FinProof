import { NextResponse } from "next/server";
import type { ProductType, ReviewStatus } from "@/domain/types";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  parseOptionalQueryString,
  parsePageSizeQuery,
  parsePositiveIntegerQuery,
  parseRiskLevel,
  requestContext,
  type QueryParseResult
} from "@/server/reviews/route-utils";

const finalReviewStatuses = ["approved", "change_requested", "rejected", "on_hold"] as const;
type FinalReviewStatus = (typeof finalReviewStatuses)[number];

export async function GET(request = new Request("http://localhost/api/v1/case-library")) {
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

  try {
    const pageResult = await createReviewService().listCaseLibrary(await requestContext(request), {
      status: status.value,
      productType: productType.value,
      affiliateId: parseOptionalQueryString(url.searchParams.get("affiliateId")),
      riskLevel: riskLevel.value,
      page: page.value,
      pageSize: pageSize.value
    });

    return NextResponse.json(pageResult);
  } catch (error) {
    return jsonForbidden(error);
  }
}

function parseProductType(value: string): ProductType | undefined {
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

function parseReviewStatus(value: string | null): QueryParseResult<FinalReviewStatus> {
  const trimmed = parseOptionalQueryString(value);

  if (!trimmed) {
    return { ok: true, value: undefined };
  }

  if (isFinalReviewStatus(trimmed)) {
    return { ok: true, value: trimmed };
  }

  if (isReviewStatus(trimmed)) {
    return { ok: false, message: "status must be a final review status" };
  }

  return { ok: false, message: "status is invalid" };
}

function isFinalReviewStatus(value: string): value is FinalReviewStatus {
  return finalReviewStatuses.includes(value as FinalReviewStatus);
}

function isReviewStatus(value: string): value is ReviewStatus {
  return (
    value === "draft" ||
    value === "submitted" ||
    value === "parsing" ||
    value === "analysis_waiting" ||
    value === "analysis_queued" ||
    value === "analysis_in_progress" ||
    value === "analysis_complete" ||
    value === "under_review" ||
    value === "change_requested" ||
    value === "rejected" ||
    value === "approved" ||
    value === "on_hold" ||
    value === "archived"
  );
}
