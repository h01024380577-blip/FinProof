"use client";

import type { JSX } from "react";
import { AlertTriangle, CircleCheck, CircleX } from "lucide-react";
import type { ReviewCase, ReviewIssue } from "@/domain/types";

export type FinalDecisionAction = Extract<
  NonNullable<ReviewIssue["finalAction"]>,
  "approve" | "reject"
>;

export type WorkbenchHeaderProps = {
  id: string;
  title: string;
  reviewStatus: ReviewCase["status"];
  statusLabel: string;
  riskLabel: string;
  productLabel: string;
  reviewer: string;
  deadline: string;
  canMutate: boolean;
  isFinalizingReview: boolean;
  onFinalizeReviewCase: (action: FinalDecisionAction) => void;
};

export function WorkbenchHeader({
  id,
  title,
  reviewStatus,
  statusLabel,
  riskLabel,
  productLabel,
  reviewer,
  deadline,
  canMutate,
  isFinalizingReview,
  onFinalizeReviewCase
}: WorkbenchHeaderProps): JSX.Element {
  const finalDecisionDisabled =
    !canMutate || isFinalizingReview || reviewStatus === "approved" || reviewStatus === "rejected";

  return (
    <section className="detail__header workbench-header">
      <div className="detail__title-block">
        <p className="detail__crumb">{id}</p>
        <h2>{title}</h2>
        <p className="detail__meta">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
          <span aria-hidden="true">|</span>
          {productLabel}
          <span aria-hidden="true">|</span>
          <span className="detail__risk-line">
            <AlertTriangle size={15} aria-hidden="true" />
            최고 위험도: {riskLabel}
          </span>
          <span aria-hidden="true">|</span>
          담당: {reviewer}
          <span aria-hidden="true">|</span>
          마감: {deadline}
        </p>
      </div>
      <div className="detail__actions" role="group" aria-label="최종 심의 결정">
        <span className="workbench-header__group-label" aria-hidden="true">
          최종 심의 결정
        </span>
        <button
          className="button detail-action-button detail-action-button--approve"
          type="button"
          data-active={reviewStatus === "approved"}
          disabled={finalDecisionDisabled}
          onClick={() => onFinalizeReviewCase("approve")}
        >
          <CircleCheck size={16} aria-hidden="true" />
          {isFinalizingReview ? "처리 중" : "승인"}
        </button>
        <button
          className="button detail-action-button detail-action-button--danger"
          type="button"
          data-active={reviewStatus === "rejected"}
          disabled={finalDecisionDisabled}
          onClick={() => onFinalizeReviewCase("reject")}
        >
          <CircleX size={16} aria-hidden="true" />
          {isFinalizingReview ? "처리 중" : "반려"}
        </button>
      </div>
    </section>
  );
}
