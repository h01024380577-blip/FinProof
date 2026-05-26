import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonForbidden,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

export async function POST(request: Request, context: RouteContext<{ documentId: string }>) {
  try {
    const { documentId } = await context.params;
    const document = await createReviewService().approveKnowledgeDocument(
      await requestContext(request),
      documentId
    );

    if (!document) {
      return jsonError("Knowledge document not found", 404, "NOT_FOUND");
    }

    return NextResponse.json({ document });
  } catch (error) {
    return jsonForbidden(error);
  }
}
