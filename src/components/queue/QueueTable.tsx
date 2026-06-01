"use client";

import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Loader2, PlayCircle, Trash2, UserCheck } from "lucide-react";
import { RiskBadge, StatusBadge } from "@/components/Badges";
import { statusLabels } from "@/domain/reviews";
import type { ProductType, ReviewAction, ReviewCase, ReviewSummary, RoleId } from "@/domain/types";

const productLabels: Record<ProductType, string> = {
  deposit: "예금/적금",
  loan: "대출",
  card: "카드",
  capital: "캐피탈",
  insurance: "보험",
  investment: "투자상품"
};

function isAnalysisWaiting(status: ReviewCase["status"]): boolean {
  return status === "submitted" || status === "analysis_waiting";
}

function canOpenWorkbench(status: ReviewCase["status"]): boolean {
  return (
    status === "analysis_complete" ||
    status === "under_review" ||
    status === "change_requested" ||
    status === "rejected" ||
    status === "approved" ||
    status === "on_hold"
  );
}

function isFinalizedHistoryStatus(status: ReviewCase["status"]): boolean {
  return status === "approved" || status === "rejected";
}

function fallbackActionsFor(role: RoleId, status: ReviewCase["status"]): ReviewAction[] {
  if (status === "analysis_waiting" && (role === "reviewer" || role === "compliance_admin")) {
    return ["start_analysis"];
  }
  if (canOpenWorkbench(status)) {
    return status === "analysis_complete" ? ["open_workbench", "view_audit"] : ["view_audit"];
  }
  return [];
}

function actionsFor(review: ReviewSummary, role: RoleId): ReviewAction[] {
  return review.availableActions ?? fallbackActionsFor(role, review.status);
}

function requestDepartment(review: ReviewSummary): string {
  if (review.requester.includes("업로드")) return "디지털마케팅팀";
  if (review.productType === "card") return "제휴마케팅팀";
  if (review.productType === "loan") return "리테일금융팀";
  return "마케팅팀";
}

export type QueueTableProps = {
  rows: ReviewSummary[];
  activeRole: RoleId;
  activeAnalysisId: string | null;
  isLoading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  canEditReviewer?: boolean;
  savingReviewerIds?: string[];
  canDeleteReviewHistory?: boolean;
  deletingReviewHistoryIds?: string[];
  onSaveReviewer?: (review: ReviewSummary, reviewer: string) => void;
  onDeleteReviewHistory?: (review: ReviewSummary) => void;
  onStartAnalysis: (review: ReviewSummary) => void;
  onOpenReview: (reviewId: string) => void;
};

function ReviewerEditor({
  review,
  isSaving,
  onSaveReviewer
}: {
  review: ReviewSummary;
  isSaving: boolean;
  onSaveReviewer: (review: ReviewSummary, reviewer: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(review.reviewer);

  function commitDraft(): void {
    const nextReviewer = draft.trim();

    if (!nextReviewer) {
      setDraft(review.reviewer);
      return;
    }

    if (nextReviewer !== review.reviewer) {
      onSaveReviewer(review, nextReviewer);
    } else {
      setDraft(nextReviewer);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation();

    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(review.reviewer);
      event.currentTarget.blur();
    }
  }

  return (
    <input
      className="reviewer-editor__input"
      aria-label={`담당자: ${review.title}`}
      value={draft}
      placeholder="미배정"
      disabled={isSaving}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    />
  );
}

type PendingOpen = {
  review: ReviewSummary;
  reviewerName: string;
};

function ReviewerConfirmToast({
  pending,
  onConfirm,
  onCancel
}: {
  pending: PendingOpen;
  onConfirm: (reviewerName: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState(pending.reviewerName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="reviewer-confirm-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="reviewer-confirm-toast"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reviewer-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="reviewer-confirm-toast__icon" aria-hidden="true">
          <UserCheck size={22} />
        </span>
        <div className="reviewer-confirm-toast__body">
          <p id="reviewer-confirm-title" className="reviewer-confirm-toast__title">
            담당자 확인
          </p>
          <p className="reviewer-confirm-toast__sub">{pending.review.title}</p>
          <input
            ref={inputRef}
            className="reviewer-confirm-toast__input"
            value={name}
            placeholder="담당자 이름"
            aria-label="담당자 이름"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
              if (e.key === "Escape") onCancel();
            }}
          />
        </div>
        <div className="reviewer-confirm-toast__actions">
          <button
            className="button button--small button--primary"
            type="button"
            disabled={!name.trim()}
            onClick={() => onConfirm(name.trim())}
          >
            검토 시작
          </button>
          <button className="button button--small" type="button" onClick={onCancel}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

export function QueueTable({
  rows,
  activeRole,
  activeAnalysisId,
  isLoading = false,
  loadingMessage = "심의 대기 목록을 불러오는 중입니다.",
  emptyMessage,
  canEditReviewer = false,
  savingReviewerIds = [],
  canDeleteReviewHistory = false,
  deletingReviewHistoryIds = [],
  onSaveReviewer,
  onDeleteReviewHistory,
  onStartAnalysis,
  onOpenReview
}: QueueTableProps): JSX.Element {
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(null);

  function handleOpenReviewClick(review: ReviewSummary): void {
    setPendingOpen({ review, reviewerName: review.reviewer || "" });
  }

  function handleConfirm(reviewerName: string): void {
    if (!pendingOpen) return;
    const reviewId = pendingOpen.review.id;
    setPendingOpen(null);
    if (reviewerName !== pendingOpen.review.reviewer && onSaveReviewer) {
      onSaveReviewer(pendingOpen.review, reviewerName);
    }
    onOpenReview(reviewId);
  }

  return (
    <div className="review-table review-table--queue" role="table" aria-label="Review cases">
      <div className="review-table__row review-table__row--head" role="row">
        <span role="columnheader">심의 ID</span>
        <span role="columnheader">제목</span>
        <span role="columnheader">상품군</span>
        <span role="columnheader">요청 부서</span>
        <span role="columnheader">상태</span>
        <span role="columnheader">위험도</span>
        <span role="columnheader">마감일</span>
        <span role="columnheader">담당자</span>
        <span role="columnheader">작업</span>
      </div>

      {isLoading ? (
        <div className="queue-empty-state">
          <Loader2 className="action-spinner" size={18} aria-hidden="true" />
          {loadingMessage}
        </div>
      ) : null}

      {!isLoading && rows.length === 0 ? (
        <div className="queue-empty-state">{emptyMessage ?? "아직 심의 요청이 없습니다."}</div>
      ) : null}

      {pendingOpen ? (
        <ReviewerConfirmToast
          pending={pendingOpen}
          onConfirm={handleConfirm}
          onCancel={() => setPendingOpen(null)}
        />
      ) : null}

      {rows.map((review) => {
        const waiting = isAnalysisWaiting(review.status);
        const rowActions = actionsFor(review, activeRole);
        const canStart = rowActions.includes("start_analysis");
        const canOpen = rowActions.includes("open_workbench");
        const canViewAudit = rowActions.includes("view_audit");
        const openable = canOpen || canViewAudit;
        const canDelete =
          canDeleteReviewHistory &&
          isFinalizedHistoryStatus(review.status) &&
          Boolean(onDeleteReviewHistory);
        const isDeleting = deletingReviewHistoryIds.includes(review.id);

        return (
          <div
            key={review.id}
            className="review-table__row"
            role="row"
            aria-label={`${review.title}`}
          >
            <span className="queue-id" role="cell">
              {review.id}
            </span>
            <strong role="cell">{review.title}</strong>
            <span role="cell">{productLabels[review.productType]}</span>
            <span role="cell">{requestDepartment(review)}</span>
            <span role="cell">
              <StatusBadge status={review.status} />
            </span>
            <span role="cell">
              {waiting || review.status === "analysis_queued" ? (
                <span className="risk-badge risk-badge--muted">분석 전</span>
              ) : (
                <RiskBadge level={review.highestRiskLevel} />
              )}
            </span>
            <span role="cell">{review.plannedPublishDate}</span>
            <span
              className="reviewer-editor"
              role="cell"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {canEditReviewer && onSaveReviewer ? (
                <ReviewerEditor
                  key={`${review.id}:${review.reviewer}`}
                  review={review}
                  isSaving={savingReviewerIds.includes(review.id)}
                  onSaveReviewer={onSaveReviewer}
                />
              ) : (
                review.reviewer || "미배정"
              )}
            </span>
            <span
              className={`queue-row-actions queue-row-actions--left${
                canDelete ? " queue-row-actions--delete" : ""
              }`}
              role="cell"
              onClick={(event) => event.stopPropagation()}
            >
              {waiting ? (
                <button
                  className="button button--small"
                  type="button"
                  disabled={!canStart || activeAnalysisId === review.id}
                  onClick={() => onStartAnalysis(review)}
                >
                  {activeAnalysisId === review.id ? (
                    <>
                      <Loader2 className="action-spinner" size={15} aria-hidden="true" />
                      분석중
                    </>
                  ) : (
                    <>
                      <PlayCircle size={15} aria-hidden="true" />
                      AI 분석 시작
                    </>
                  )}
                </button>
              ) : null}
              {!waiting && review.status === "analysis_complete" ? (
                <button
                  className="button button--small button--primary"
                  type="button"
                  onClick={() => handleOpenReviewClick(review)}
                >
                  검토하기
                </button>
              ) : null}
              {!waiting && canViewAudit && review.status !== "analysis_complete" ? (
                <button
                  className="button button--small"
                  type="button"
                  onClick={() => onOpenReview(review.id)}
                >
                  상세보기
                </button>
              ) : null}
              {!waiting && !openable ? (
                <span className="queue-row-note">{statusLabels[review.status]}</span>
              ) : null}
              {canDelete ? (
                <button
                  className="icon-button icon-button--small icon-button--danger"
                  type="button"
                  aria-label={`심의 이력 삭제: ${review.title}`}
                  title="심의 이력 삭제"
                  disabled={isDeleting}
                  onClick={() => onDeleteReviewHistory?.(review)}
                >
                  {isDeleting ? (
                    <Loader2 className="action-spinner" size={16} aria-hidden="true" />
                  ) : (
                    <Trash2 size={16} aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
