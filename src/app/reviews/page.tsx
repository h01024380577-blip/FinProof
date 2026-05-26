import { Suspense } from "react";
import { ReviewQueue } from "@/components/ReviewQueue";

export default function ReviewsPage() {
  return (
    <Suspense fallback={<p className="queue-empty-state">심의 큐를 불러오는 중입니다.</p>}>
      <ReviewQueue />
    </Suspense>
  );
}
