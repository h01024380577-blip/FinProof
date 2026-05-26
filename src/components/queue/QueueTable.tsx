"use client";

import type { JSX } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { RiskBadge, StatusBadge } from "@/components/Badges";
import { statusLabels } from "@/domain/reviews";
import type {
  ProductType,
  ReviewAction,
  ReviewCase,
  ReviewSummary,
  RoleId
} from "@/domain/types";

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
  emptyMessage?: string;
  onStartAnalysis: (review: ReviewSummary) => void;
  onOpenReview: (reviewId: string) => void;
};

export function QueueTable({
  rows,
  activeRole,
  activeAnalysisId,
  isLoading = false,
  emptyMessage,
  onStartAnalysis,
  onOpenReview
}: QueueTableProps): JSX.Element {
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
          <Loader2 size={18} aria-hidden="true" /> 심의 큐를 불러오는 중입니다.
        </div>
      ) : null}

      {!isLoading && rows.length === 0 ? (
        <div className="queue-empty-state">{emptyMessage ?? "아직 심의 요청이 없습니다."}</div>
      ) : null}

      {rows.map((review) => {
        const waiting = isAnalysisWaiting(review.status);
        const rowActions = actionsFor(review, activeRole);
        const canStart = rowActions.includes("start_analysis");
        const canOpen = rowActions.includes("open_workbench");
        const canViewAudit = rowActions.includes("view_audit");
        const openable = canOpen || canViewAudit;

        return (
          <div
            key={review.id}
            className="review-table__row"
            role="row"
            tabIndex={openable ? 0 : -1}
            aria-label={`${review.title}`}
            data-clickable={openable}
            onClick={() => openable && onOpenReview(review.id)}
            onKeyDown={(event) => {
              if (openable && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onOpenReview(review.id);
              }
            }}
          >
            <span className="queue-id" role="cell">{review.id}</span>
            <strong role="cell">{review.title}</strong>
            <span role="cell">{productLabels[review.productType]}</span>
            <span role="cell">{requestDepartment(review)}</span>
            <span role="cell"><StatusBadge status={review.status} /></span>
            <span role="cell">
              {waiting || review.status === "analysis_queued" ? (
                <span className="risk-badge risk-badge--muted">분석 전</span>
              ) : (
                <RiskBadge level={review.highestRiskLevel} />
              )}
            </span>
            <span role="cell">{review.plannedPublishDate}</span>
            <span role="cell">{review.reviewer}</span>
            <span className="queue-row-actions" role="cell" onClick={(event) => event.stopPropagation()}>
              {waiting ? (
                <button
                  className="button button--small"
                  type="button"
                  disabled={!canStart || activeAnalysisId === review.id}
                  onClick={() => onStartAnalysis(review)}
                >
                  <PlayCircle size={15} aria-hidden="true" />
                  {activeAnalysisId === review.id ? "시작 중" : "AI 분석 시작"}
                </button>
              ) : null}
              {!waiting && !openable ? (
                <span className="queue-row-note">{statusLabels[review.status]}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
