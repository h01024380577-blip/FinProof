import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  jsonRouteError,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

export async function DELETE(request: Request, context: RouteContext<{ documentId: string }>) {
  const { documentId } = await context.params;

  try {
    const document = await createReviewService().deleteKnowledgeDocument(
      await requestContext(request),
      documentId
    );

    if (!document) {
      return jsonError("Knowledge document not found", 404, "NOT_FOUND");
    }

    return NextResponse.json({
      deleted: true,
      documentId: document.id
    });
  } catch (error) {
    return jsonRouteError(error);
  }
}
