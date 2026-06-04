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

function requesterTableStatus(status: ReviewCase["status"]): {
  label: "검토중" | "승인" | "반려";
  badgeStatus: "in-progress" | "approved" | "rejected";
} {
  if (status === "approved") return { label: "승인", badgeStatus: "approved" };
  if (status === "rejected") return { label: "반려", badgeStatus: "rejected" };
  return { label: "검토중", badgeStatus: "in-progress" };
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
  const { roleContext, canUseRequesterCenter } = useRequesterAccess();

  if (!canUseRequesterCenter) return <RequesterLoginRequired />;

  return (
    <div className="requester-request-center">
      <RequesterHistoryPanel apiHeaders={roleContext.apiHeaders} />
    </div>
  );
}

function RequesterHistoryPanel({
  apiHeaders
}: {
  apiHeaders: (extra?: Record<string, string>) => Record<string, string>;
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
        const ownReviews = body.items ?? body.reviewCases ?? [];
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
  }, [apiHeaders]);

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
        <div className="review-table review-table--history" role="grid" aria-label="요청 기록 목록">
          <div className="review-table__row review-table__row--head" role="row">
            <span role="columnheader">요청번호</span>
            <span role="columnheader">제목</span>
            <span role="columnheader">제휴사</span>
            <span role="columnheader">상품유형</span>
            <span role="columnheader">예정 발행일</span>
            <span role="columnheader">담당자</span>
            <span role="columnheader">심의 상태</span>
          </div>
          {requests.map((review) => (
            <RequesterHistoryRow key={review.id} review={review} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

type DraftLine =
  | { kind: "section"; text: string }
  | { kind: "issue"; num: string; text: string }
  | { kind: "bullet"; label: string; value: string }
  | { kind: "meta"; label: string; value: string }
  | { kind: "plain"; text: string }
  | { kind: "spacer" };

function parseDraftLine(raw: string): DraftLine {
  const line = raw.trim();
  if (!line) return { kind: "spacer" };

  if (/^(주요\s|종합|수정 요청 의견)/.test(line)) return { kind: "section", text: line };

  const issueMatch = /^(\d+)\.\s+(.+)/.exec(line);
  if (issueMatch) return { kind: "issue", num: issueMatch[1], text: issueMatch[2] };

  if (line.startsWith("- ")) {
    const rest = line.slice(2);
    const ci = rest.indexOf(": ");
    if (ci > 0) return { kind: "bullet", label: rest.slice(0, ci), value: rest.slice(ci + 2) };
    return { kind: "plain", text: rest };
  }

  const ci = line.indexOf(": ");
  if (ci > 0 && ci < 14) return { kind: "meta", label: line.slice(0, ci), value: line.slice(ci + 2) };

  return { kind: "plain", text: line };
}


function renderDraftLine(line: DraftLine, key: number): JSX.Element | null {
  if (line.kind === "spacer") return <div key={key} className="draft-note__gap" />;
  if (line.kind === "section") return <p key={key} className="draft-note__section">{line.text}</p>;
  if (line.kind === "issue")
    return (
      <p key={key} className="draft-note__issue-heading">
        <span className="draft-note__issue-num">{line.num}</span>
        {line.text}
      </p>
    );
  if (line.kind === "bullet" || line.kind === "meta")
    return (
      <p key={key} className={`draft-note__kv draft-note__kv--${line.kind}`}>
        <span className="draft-note__kv-label">{line.label}</span>
        <span className="draft-note__kv-value">{line.value}</span>
      </p>
    );
  return <p key={key} className="draft-note__plain">{line.text}</p>;
}

function DraftNote({ text }: { text: string }): JSX.Element {
  const parsed = text.split("\n").map(parseDraftLine);

  return (
    <div className="draft-note">
      {parsed
        .filter((l) => !(l.kind === "section" && l.text.startsWith("수정 요청 의견")))
        .map((line, i) => renderDraftLine(line, i))}
    </div>
  );
}

function RequesterHistoryRow({ review }: { review: RequestHistoryItem }): JSX.Element {
  const showDraft = review.status === "rejected" && Boolean(review.currentDraft?.trim());
  const { label, badgeStatus } = requesterTableStatus(review.status);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div className="review-table__row" role="row" aria-label={review.title}>
        <span className="queue-id" role="cell">
          {review.id}
        </span>
        <strong role="cell">{review.title}</strong>
        <span role="cell">{review.affiliate}</span>
        <span role="cell">{productLabels[review.productType]}</span>
        <span role="cell">{review.plannedPublishDate}</span>
        <span role="cell">{review.reviewer || "미배정"}</span>
        <span role="cell" className="history-row__status-cell">
          <span className="status-badge" data-status={badgeStatus}>
            {label}
          </span>
          {showDraft ? (
            <button
              type="button"
              className="rejection-toggle"
              aria-expanded={isOpen}
              aria-label={isOpen ? "수정 요청 내용 접기" : "수정 요청 내용 펼치기"}
              onClick={() => setIsOpen((o) => !o)}
            >
              {isOpen ? "▾" : "▸"}
            </button>
          ) : null}
        </span>
      </div>
      {showDraft && isOpen ? (
        <div className="review-table__row review-table__row--rejection-note" role="row">
          <div role="cell" className="request-history-rejection-note" aria-label="수정 요청">
            <strong>수정 요청</strong>
            <DraftNote text={review.currentDraft ?? ""} />
          </div>
        </div>
      ) : null}
    </>
  );
}
