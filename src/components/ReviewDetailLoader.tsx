"use client";

import { useEffect, useState, type JSX } from "react";
import type { ReviewCase } from "@/domain/types";
import { useRole } from "./RoleContext";
import { ReviewDetailWorkspace } from "./ReviewDetailWorkspace";

type ReviewCaseResponse = {
  reviewCase: ReviewCase;
};

export function ReviewDetailLoader({ reviewId }: { reviewId: string }): JSX.Element {
  const { apiHeaders } = useRole();
  const [review, setReview] = useState<ReviewCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadReview() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/v1/review-cases/${reviewId}`, {
          headers: apiHeaders()
        });

        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? "운영 JWT를 입력한 뒤 다시 시도해 주세요."
              : "심의 건을 불러오지 못했습니다."
          );
        }

        const body = (await response.json()) as ReviewCaseResponse;

        if (mounted) {
          setReview(body.reviewCase);
        }
      } catch (loadError) {
        if (mounted) {
          setError(
            loadError instanceof Error ? loadError.message : "심의 건을 불러오지 못했습니다."
          );
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadReview();

    return () => {
      mounted = false;
    };
  }, [apiHeaders, reviewId]);

  if (isLoading) {
    return <p className="queue-empty-state">심의 건을 불러오는 중입니다.</p>;
  }

  if (error) {
    return (
      <p className="interaction-error" role="alert">
        {error}
      </p>
    );
  }

  if (!review) {
    return (
      <p className="interaction-error" role="alert">
        심의 건을 찾을 수 없습니다.
      </p>
    );
  }

  return <ReviewDetailWorkspace review={review} loadSupportData />;
}
