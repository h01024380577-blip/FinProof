"use client";

import { useEffect, useState, type JSX } from "react";
import { Loader2 } from "lucide-react";
import { productLabels } from "@/domain/reviews";
import type { ReviewCase, ReviewSummary, RoleId } from "@/domain/types";
import { SamplePackageSelector } from "./SamplePackageSelector";
import { useRole } from "./RoleContext";

type RequesterUser = {
  name: string;
  role: RoleId;
  userId: string;
};

type RequesterRoleContext = ReturnType<typeof useRole> & {
  isAuthenticated?: boolean;
  currentUser?: RequesterUser | null;
};

type ReviewCasesResponse = {
  items?: ReviewSummary[];
  reviewCases?: ReviewSummary[];
};

type ReviewCaseResponse = {
  reviewCase?: ReviewCase;
};

type RequestHistoryItem = ReviewSummary &
  Partial<Pick<ReviewCase, "currentDraft" | "currentDraftVersion">>;

function isFinalDecision(status: ReviewCase["status"]): boolean {
  return status === "approved" || status === "rejected";
}

function requesterStatusLabel(status: ReviewCase["status"]): "검토중" | "심의완료" {
  return isFinalDecision(status) ? "심의완료" : "검토중";
}

function reviewResultLabel(status: ReviewCase["status"]): "승인" | "반려" | "판단 대기" {
  if (status === "approved") return "승인";
  if (status === "rejected") return "반려";
  return "판단 대기";
}

function belongsToRequester(review: ReviewSummary, requesterName: string): boolean {
  const requester = review.requester.trim();

  return requester === requesterName || requester.includes(requesterName);
}

function useRequesterAccess(): {
  roleContext: RequesterRoleContext;
  requesterName: string;
  canUseRequesterCenter: boolean;
} {
  const roleContext = useRole() as RequesterRoleContext;
  const requesterName = roleContext.currentUser?.name.trim() ?? "";
  const canUseRequesterCenter =
    roleContext.isAuthenticated === true &&
    roleContext.activeRole === "requester" &&
    roleContext.currentUser?.role === "requester" &&
    requesterName.length > 0;

  return { roleContext, requesterName, canUseRequesterCenter };
}

function RequesterLoginRequired(): JSX.Element {
  return (
    <section className="queue-panel" aria-label="요청자 로그인 필요">
      <p className="queue-empty-state">요청자 계정으로 로그인해 주세요.</p>
    </section>
  );
}

export function RequesterRequestCenter(): JSX.Element {
  const { canUseRequesterCenter } = useRequesterAccess();

  if (!canUseRequesterCenter) return <RequesterLoginRequired />;

  return (
    <div className="requester-request-center">
      <SamplePackageSelector />
    </div>
  );
}

export function RequesterRequestHistory(): JSX.Element {
  const { roleContext, requesterName, canUseRequesterCenter } = useRequesterAccess();

  if (!canUseRequesterCenter) return <RequesterLoginRequired />;

  return (
    <div className="requester-request-center">
      <RequesterHistoryPanel apiHeaders={roleContext.apiHeaders} requesterName={requesterName} />
    </div>
  );
}

function RequesterHistoryPanel({
  apiHeaders,
  requesterName
}: {
  apiHeaders: (extra?: Record<string, string>) => Record<string, string>;
  requesterName: string;
}): JSX.Element {
  const [requests, setRequests] = useState<RequestHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadRequesterHistory(): Promise<void> {
      if (mounted) {
        setIsLoading(true);
        setLoadError(null);
      }

      try {
        const response = await fetch("/api/v1/review-cases", {
          headers: apiHeaders()
        });

        if (!response.ok) {
          throw new Error("요청 기록을 불러오지 못했습니다.");
        }

        const body = (await response.json()) as ReviewCasesResponse;
        const ownReviews = (body.items ?? body.reviewCases ?? []).filter((review) =>
          belongsToRequester(review, requesterName)
        );
        const detailedReviews = await Promise.all(
          ownReviews.map(async (review) => {
            if (review.status !== "rejected") {
              return review;
            }

            try {
              const detailResponse = await fetch(
                `/api/v1/review-cases/${encodeURIComponent(review.id)}`,
                {
                  headers: apiHeaders()
                }
              );

              if (!detailResponse.ok) {
                return review;
              }

              const detailBody = (await detailResponse.json()) as ReviewCaseResponse;

              return {
                ...review,
                ...detailBody.reviewCase
              };
            } catch {
              return review;
            }
          })
        );

        if (mounted) {
          setRequests(detailedReviews);
        }
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : "요청 기록을 불러오지 못했습니다.");
          setRequests([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadRequesterHistory();

    return () => {
      mounted = false;
    };
  }, [apiHeaders, requesterName]);

  return (
    <section className="queue-panel" aria-label="요청 기록">
      {isLoading ? (
        <div className="queue-empty-state">
          <Loader2 className="action-spinner" size={18} aria-hidden="true" />
          요청 기록을 불러오는 중입니다.
        </div>
      ) : null}

      {loadError ? (
        <p className="interaction-error" role="alert">
          {loadError}
        </p>
      ) : null}

      {!isLoading && !loadError && requests.length === 0 ? (
        <p className="queue-empty-state">아직 요청 기록이 없습니다.</p>
      ) : null}

      {!isLoading && !loadError && requests.length > 0 ? (
        <div className="history-decision-tabs" aria-label="요청 기록 목록">
          {requests.map((review) => (
            <RequesterHistoryCard key={review.id} review={review} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RequesterHistoryCard({ review }: { review: RequestHistoryItem }): JSX.Element {
  const showDraft = review.status === "rejected" && Boolean(review.currentDraft?.trim());

  return (
    <article className="kpi-card" aria-label={review.title}>
      <div className="queue-row-actions">
        <span className="queue-id">{review.id}</span>
        <span className="status-badge" data-status={review.status}>
          {requesterStatusLabel(review.status)}
        </span>
        <span className="status-badge" data-status={review.status}>
          {reviewResultLabel(review.status)}
        </span>
      </div>
      <h3>{review.title}</h3>
      <p>
        {review.affiliate} · {productLabels[review.productType]} · {review.plannedPublishDate}
      </p>
      <p>담당자: {review.reviewer || "미배정"}</p>

      {showDraft ? (
        <section aria-label="수정 요청">
          <div className="queue-row-actions">
            <strong>수정 요청</strong>
            <span className="queue-id">버전 {review.currentDraftVersion ?? 0}</span>
          </div>
          <p>{review.currentDraft}</p>
        </section>
      ) : null}
    </article>
  );
}
