"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, RefreshCw } from "lucide-react";
import type { ReviewStatus, RoleId } from "@/domain/types";
import { useRole } from "./RoleContext";

const POLL_INTERVAL_MS = 30_000;
const NEW_REVIEW_STATUSES = new Set<ReviewStatus>(["submitted", "analysis_waiting"]);
const COMPLETED_REQUEST_STATUSES = new Set<ReviewStatus>(["approved", "rejected"]);

type NotificationRoleContext = {
  activeRole: RoleId;
  apiHeaders: (extra?: Record<string, string>) => Record<string, string>;
  isAuthenticated?: boolean;
  currentUser?: {
    name: string;
    role: RoleId | string;
    userId: string;
  } | null;
};

type NotificationReview = {
  id: string;
  title: string;
  requester?: string;
  status: ReviewStatus;
};

type NotificationItem = {
  id: string;
  message: string;
  title: string;
  reviewId: string;
  result?: "승인" | "반려";
};

type ReviewListResponse =
  | NotificationReview[]
  | { items?: NotificationReview[]; reviewCases?: NotificationReview[] };

function normalizeText(value: string | undefined) {
  return value?.trim() ?? "";
}

function isReviewerRole(role: RoleId) {
  return role === "reviewer" || role === "compliance_admin";
}

function isRequesterMatch(
  reviewRequester: string | undefined,
  currentUserName: string | undefined
) {
  const requester = normalizeText(reviewRequester);
  const name = normalizeText(currentUserName);

  return name.length > 0 && (requester === name || requester.includes(name));
}

function resultLabel(status: ReviewStatus) {
  if (status === "approved") {
    return "승인";
  }

  if (status === "rejected") {
    return "반려";
  }

  return undefined;
}

function parseReviewList(payload: ReviewListResponse): NotificationReview[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  return payload.items ?? payload.reviewCases ?? [];
}

async function fetchNotificationReviews(
  apiHeaders: NotificationRoleContext["apiHeaders"]
): Promise<NotificationReview[]> {
  const response = await fetch("/api/v1/review-cases", {
    headers: apiHeaders()
  });

  if (!response.ok) {
    throw new Error("Failed to fetch review cases");
  }

  const payload = (await response.json()) as ReviewListResponse;

  return parseReviewList(payload);
}

function buildNotifications(
  reviews: NotificationReview[],
  activeRole: RoleId,
  currentUserName: string | undefined
): NotificationItem[] {
  return reviews.flatMap((review) => {
    if (isReviewerRole(activeRole) && NEW_REVIEW_STATUSES.has(review.status)) {
      return [
        {
          id: `${review.id}-new-request`,
          message: "신규 심의 요청이 도착했습니다",
          title: review.title,
          reviewId: review.id
        }
      ];
    }

    const result = resultLabel(review.status);

    if (
      activeRole === "requester" &&
      result &&
      COMPLETED_REQUEST_STATUSES.has(review.status) &&
      isRequesterMatch(review.requester, currentUserName)
    ) {
      return [
        {
          id: `${review.id}-completed`,
          message: "요청한 건의 심의가 완료됐습니다",
          title: review.title,
          reviewId: review.id,
          result
        }
      ];
    }

    return [];
  });
}

export function NotificationCenter() {
  const roleContext = useRole() as NotificationRoleContext;
  const { activeRole, apiHeaders, currentUser } = roleContext;
  const isAuthenticated = roleContext.isAuthenticated === true;
  const [reviews, setReviews] = useState<NotificationReview[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadReviews = useCallback(async () => {
    if (!isAuthenticated) {
      setReviews([]);
      setErrorMessage("");
      return;
    }

    try {
      const nextReviews = await fetchNotificationReviews(apiHeaders);
      setReviews(nextReviews);
      setErrorMessage("");
    } catch {
      setErrorMessage("알림을 불러오지 못했습니다.");
    }
  }, [apiHeaders, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let isActive = true;

    void fetchNotificationReviews(apiHeaders)
      .then((nextReviews) => {
        if (!isActive) {
          return;
        }

        setReviews(nextReviews);
        setErrorMessage("");
      })
      .catch(() => {
        if (isActive) {
          setErrorMessage("알림을 불러오지 못했습니다.");
        }
      });

    const intervalId = window.setInterval(() => {
      void fetchNotificationReviews(apiHeaders)
        .then((nextReviews) => {
          if (!isActive) {
            return;
          }

          setReviews(nextReviews);
          setErrorMessage("");
        })
        .catch(() => {
          if (isActive) {
            setErrorMessage("알림을 불러오지 못했습니다.");
          }
        });
    }, POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [apiHeaders, isAuthenticated]);

  const notifications = useMemo(
    () => (isAuthenticated ? buildNotifications(reviews, activeRole, currentUser?.name) : []),
    [activeRole, currentUser?.name, isAuthenticated, reviews]
  );
  const notificationCount = notifications.length;

  const handleToggle = () => {
    const nextIsOpen = !isOpen;

    setIsOpen(nextIsOpen);

    if (nextIsOpen) {
      void loadReviews();
    }
  };

  return (
    <div className="notification-center">
      <button
        aria-controls={isOpen ? "notification-center-popover" : undefined}
        aria-expanded={isOpen}
        aria-label="알림"
        className="topbar__icon-button notification-center__button"
        onClick={handleToggle}
        title="알림"
        type="button"
      >
        <Bell size={19} aria-hidden="true" />
        {notificationCount > 0 ? (
          <span className="notification-center__badge" aria-hidden="true">
            {notificationCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          className="notification-center__popover"
          id="notification-center-popover"
          role="dialog"
          aria-label="알림 목록"
        >
          <div className="notification-center__header">
            <strong>알림</strong>
            <button
              aria-label="알림 새로고침"
              className="notification-center__refresh"
              onClick={() => void loadReviews()}
              type="button"
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>

          {errorMessage ? <p role="status">{errorMessage}</p> : null}

          {notificationCount === 0 && !errorMessage ? (
            <p className="notification-center__empty">새 알림이 없습니다.</p>
          ) : null}

          {notificationCount > 0 ? (
            <ul className="notification-center__list">
              {notifications.map((notification) => (
                <li className="notification-center__item" key={notification.id}>
                  <p>{notification.message}</p>
                  <span>{notification.title}</span>
                  <span>{notification.reviewId}</span>
                  {notification.result ? <span>결과: {notification.result}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
