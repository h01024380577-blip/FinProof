"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, RefreshCw } from "lucide-react";
import type { ReviewStatus, RoleId } from "@/domain/types";
import { useRole } from "./RoleContext";

const POLL_INTERVAL_MS = 30_000;
const NEW_REVIEW_STATUSES = new Set<ReviewStatus>(["submitted", "analysis_waiting"]);
const COMPLETED_REQUEST_STATUSES = new Set<ReviewStatus>(["approved", "rejected"]);
const MAX_REGULATORY_NOTIFICATIONS = 20;

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

type NotificationChangeSet = {
  id: string;
  changeSummary?: string;
  changedSections?: unknown[];
  createdAt?: string;
};

type ChangeSetListResponse = { changeSets?: NotificationChangeSet[] };

type ReadNotifications = {
  scopeKey: string;
  ids: Set<string>;
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

// 법령 변경 추적 폴러(자동/수동)가 변경을 감지하면 RegulatoryChangeSet 행을 만든다.
// 심의자/관리자에게는 그 변경세트를 인앱 알림으로 파생해 보여준다.
async function fetchRegulatoryChangeSets(
  apiHeaders: NotificationRoleContext["apiHeaders"]
): Promise<NotificationChangeSet[]> {
  try {
    const response = await fetch("/api/v1/regulatory-change-sets", { headers: apiHeaders() });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as ChangeSetListResponse;

    return payload.changeSets ?? [];
  } catch {
    return [];
  }
}

function buildRegulatoryNotifications(
  changeSets: NotificationChangeSet[],
  activeRole: RoleId
): NotificationItem[] {
  if (!isReviewerRole(activeRole)) {
    return [];
  }

  return changeSets
    .filter((changeSet) => (changeSet.changedSections?.length ?? 0) > 0)
    .slice()
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
    .slice(0, MAX_REGULATORY_NOTIFICATIONS)
    .map((changeSet) => ({
      id: `reg-${changeSet.id}`,
      message: "법령 변경이 감지되었습니다",
      title: normalizeText(changeSet.changeSummary) || changeSet.id,
      reviewId: changeSet.id
    }));
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
  const notificationScopeKey = `${activeRole}:${currentUser?.userId ?? ""}:${currentUser?.name ?? ""}`;
  const [reviews, setReviews] = useState<NotificationReview[]>([]);
  const [changeSets, setChangeSets] = useState<NotificationChangeSet[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState<ReadNotifications>(() => ({
    scopeKey: "",
    ids: new Set()
  }));
  const [errorMessage, setErrorMessage] = useState("");

  const markNotificationsAsRead = useCallback(
    (nextReviews: NotificationReview[], nextChangeSets: NotificationChangeSet[]) => {
      const nextNotifications = [
        ...buildNotifications(nextReviews, activeRole, currentUser?.name),
        ...buildRegulatoryNotifications(nextChangeSets, activeRole)
      ];

      if (nextNotifications.length === 0) {
        return;
      }

      setReadNotifications((current) => {
        const nextIds =
          current.scopeKey === notificationScopeKey ? new Set(current.ids) : new Set<string>();
        let changed = current.scopeKey !== notificationScopeKey;

        for (const notification of nextNotifications) {
          if (!nextIds.has(notification.id)) {
            nextIds.add(notification.id);
            changed = true;
          }
        }

        return changed ? { scopeKey: notificationScopeKey, ids: nextIds } : current;
      });
    },
    [activeRole, currentUser?.name, notificationScopeKey]
  );

  const refresh = useCallback(
    async (options: { markAsRead?: boolean } = {}) => {
      if (!isAuthenticated) {
        setReviews([]);
        setChangeSets([]);
        setErrorMessage("");
        return;
      }

      try {
        const [nextReviews, nextChangeSets] = await Promise.all([
          fetchNotificationReviews(apiHeaders),
          isReviewerRole(activeRole)
            ? fetchRegulatoryChangeSets(apiHeaders)
            : Promise.resolve<NotificationChangeSet[]>([])
        ]);
        setReviews(nextReviews);
        setChangeSets(nextChangeSets);
        if (options.markAsRead) {
          markNotificationsAsRead(nextReviews, nextChangeSets);
        }
        setErrorMessage("");
      } catch {
        setErrorMessage("알림을 불러오지 못했습니다.");
      }
    },
    [activeRole, apiHeaders, isAuthenticated, markNotificationsAsRead]
  );

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    // Kick off async data loading on mount; state updates happen after await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated, refresh]);

  const notifications = useMemo(
    () =>
      isAuthenticated
        ? [
            ...buildNotifications(reviews, activeRole, currentUser?.name),
            ...buildRegulatoryNotifications(changeSets, activeRole)
          ]
        : [],
    [activeRole, changeSets, currentUser?.name, isAuthenticated, reviews]
  );
  const readNotificationIds =
    readNotifications.scopeKey === notificationScopeKey ? readNotifications.ids : new Set<string>();
  const unreadNotificationCount = notifications.filter(
    (notification) => !readNotificationIds.has(notification.id)
  ).length;

  const handleToggle = () => {
    const nextIsOpen = !isOpen;

    setIsOpen(nextIsOpen);

    if (nextIsOpen) {
      markNotificationsAsRead(reviews, changeSets);
      void refresh({ markAsRead: true });
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
        {unreadNotificationCount > 0 ? (
          <span className="notification-center__badge" aria-hidden="true">
            {unreadNotificationCount}
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
              onClick={() => void refresh({ markAsRead: true })}
              type="button"
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>

          {errorMessage ? <p role="status">{errorMessage}</p> : null}

          {notifications.length === 0 && !errorMessage ? (
            <p className="notification-center__empty">새 알림이 없습니다.</p>
          ) : null}

          {notifications.length > 0 ? (
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
