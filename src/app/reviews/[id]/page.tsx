import { ReviewDetailLoader } from "@/components/ReviewDetailLoader";

export const dynamic = "force-dynamic";

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <ReviewDetailLoader reviewId={id} />;
}
