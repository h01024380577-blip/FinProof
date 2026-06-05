"use client";

import { useEffect, useRef, useState, type JSX } from "react";
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
  investment: "투자상품",
  image_test: "이미지 테스트"
};

function isAnalysisWaiting(status: ReviewCase["status"]): boolean {
  return status === "submitted" || status === "analysis_waiting" || status === "analysis_queued";
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
  analysisStates?: QueueAnalysisStates;
  isLoading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  canDeleteReviewHistory?: boolean;
  deletingReviewHistoryIds?: string[];
  loggedInUser?: { name: string } | null;
  onSaveReviewer?: (review: ReviewSummary, reviewer: string) => void;
  onDeleteReviewHistory?: (review: ReviewSummary) => void;
  onStartAnalysis: (review: ReviewSummary) => void;
  onOpenReview: (reviewId: string) => void;
};

export type QueueAnalysisState = {
  status: "queued" | "running" | "completed" | "failed";
  errorMessage?: string;
};

export type QueueAnalysisStates = Record<string, QueueAnalysisState | undefined>;

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
  analysisStates = {},
  isLoading = false,
  loadingMessage = "심의 대기 목록을 불러오는 중입니다.",
  emptyMessage,
  canDeleteReviewHistory = false,
  deletingReviewHistoryIds = [],
  loggedInUser,
  onSaveReviewer,
  onDeleteReviewHistory,
  onStartAnalysis,
  onOpenReview
}: QueueTableProps): JSX.Element {
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(null);

  function handleOpenReviewClick(review: ReviewSummary): void {
    if (loggedInUser) {
      const reviewerName = loggedInUser.name;
      if (reviewerName !== review.reviewer && onSaveReviewer) {
        onSaveReviewer(review, reviewerName);
      }
      onOpenReview(review.id);
      return;
    }
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
        <span role="columnheader">요청자</span>
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
        const analysisState = analysisStates[review.id];
        const rowActions = actionsFor(review, activeRole);
        const canStart = rowActions.includes("start_analysis");
        const canOpen = rowActions.includes("open_workbench");
        const canViewAudit = rowActions.includes("view_audit");
        const openable = canOpen || canViewAudit;
        const analysisFailed = waiting && analysisState?.status === "failed";
        const analysisFailureText = analysisFailed
          ? `분석 실패${analysisState.errorMessage ? `: ${analysisState.errorMessage}` : ""}`
          : "";
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
            <span role="cell">{review.requester || "미기재"}</span>
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
              {review.reviewer || "미배정"}
            </span>
            <span
              className={`queue-row-actions queue-row-actions--left${
                canDelete ? " queue-row-actions--delete" : ""
              }${analysisFailed ? " queue-row-actions--failed" : ""}`}
              role="cell"
              onClick={(event) => event.stopPropagation()}
            >
              {waiting ? (
                <button
                  className="button button--small queue-row-action-button"
                  type="button"
                  disabled={
                    !canStart ||
                    activeAnalysisId === review.id ||
                    analysisState?.status === "queued" ||
                    analysisState?.status === "running"
                  }
                  onClick={() => onStartAnalysis(review)}
                >
                  {analysisState?.status === "failed" ? (
                    <>
                      <PlayCircle size={15} aria-hidden="true" />
                      AI 분석 재시도
                    </>
                  ) : activeAnalysisId === review.id ||
                    analysisState?.status === "queued" ||
                    analysisState?.status === "running" ||
                    review.status === "analysis_queued" ? (
                    <>
                      <Loader2 className="action-spinner" size={15} aria-hidden="true" />
                      {analysisState?.status === "queued" ? "대기중" : "분석중"}
                    </>
                  ) : (
                    <>
                      <PlayCircle size={15} aria-hidden="true" />
                      AI 분석 시작
                    </>
                  )}
                </button>
              ) : null}
              {analysisFailed ? (
                <span
                  className="queue-row-note queue-row-note--analysis-error"
                  title={analysisFailureText}
                  aria-label={analysisFailureText}
                >
                  {analysisFailureText}
                </span>
              ) : null}
              {!waiting && review.status === "analysis_complete" ? (
                <button
                  className="button button--small button--primary queue-row-action-button"
                  type="button"
                  onClick={() => handleOpenReviewClick(review)}
                >
                  검토하기
                </button>
              ) : null}
              {!waiting && canViewAudit && review.status !== "analysis_complete" ? (
                <button
                  className="button button--small queue-row-action-button"
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
                  className="icon-button icon-button--small icon-button--danger queue-row-delete-button"
                  type="button"
                  aria-label={`심의 이력 삭제: ${review.title}`}
                  title="심의 이력 삭제"
                  disabled={isDeleting}
                  onClick={() => onDeleteReviewHistory?.(review)}
                >
                  {isDeleting ? (
                    <Loader2 className="action-spinner" size={20} aria-hidden="true" />
                  ) : (
                    <Trash2 size={20} aria-hidden="true" />
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
