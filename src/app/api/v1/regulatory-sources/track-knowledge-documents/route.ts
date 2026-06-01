import { NextResponse } from "next/server";
import { createReviewService } from "@/server/reviews/review-service";
import { jsonRouteError, requestContext } from "@/server/reviews/route-utils";

export async function POST(
  request = new Request("http://localhost/api/v1/regulatory-sources/track-knowledge-documents")
) {
  try {
    const result = await createReviewService().trackKnowledgeDocumentRegulatoryChanges(
      await requestContext(request)
    );

    return NextResponse.json({ result });
  } catch (error) {
    return jsonRouteError(error);
  }
}
