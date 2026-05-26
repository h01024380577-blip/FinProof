import { notFound } from "next/navigation";
import { ReviewDetailWorkspace } from "@/components/ReviewDetailWorkspace";
import { reviewCases } from "@/domain/reviews";
import { createReviewService } from "@/server/reviews/review-service";
import { requestContext } from "@/server/reviews/route-utils";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return reviewCases.map((review) => ({ id: review.id }));
}

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const review = await createReviewService().getReviewCase(
    await requestContext(new Request(`http://localhost/reviews/${id}`)),
    id
  );

  if (!review) {
    notFound();
  }

  return <ReviewDetailWorkspace review={review} loadSupportData />;
}
