"use client";

import type { JSX } from "react";
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { RiskBadge, StatusBadge } from "@/components/Badges";
import type { ReviewCase, ReviewIssue } from "@/domain/types";

export type FinalDecisionAction = Extract<
  NonNullable<ReviewIssue["finalAction"]>,
  "approve" | "reject"
>;

export type WorkbenchHeaderProps = {
  id: string;
  title: string;
  reviewStatus: ReviewCase["status"];
  riskLevel: ReviewCase["highestRiskLevel"];
  productLabel: string;
  requester: string;
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
  riskLevel,
  productLabel,
  requester,
  reviewer,
  deadline,
  canMutate,
  isFinalizingReview,
  onFinalizeReviewCase
}: WorkbenchHeaderProps): JSX.Element {
  const finalDecisionDisabled =
    !canMutate || isFinalizingReview || reviewStatus === "approved" || reviewStatus === "rejected";
  const requestDepartment = requestDepartmentFor({ requester, productLabel });

  return (
    <section className="detail__header workbench-header" aria-label="심의 상세 요약">
      <div className="workbench-summary" role="table" aria-label="심의 상세 요약">
        <div className="workbench-summary-row workbench-summary-row--head" role="row">
          <span role="columnheader">심의 ID</span>
          <span role="columnheader">제목</span>
          <span role="columnheader">상품군</span>
          <span role="columnheader">요청 부서</span>
          <span role="columnheader">요청자</span>
          <span role="columnheader">상태</span>
          <span role="columnheader">위험도</span>
          <span role="columnheader">마감일</span>
          <span role="columnheader">담당자</span>
        </div>
        <div className="workbench-summary-row" role="row" aria-label={title}>
          <span className="queue-id" role="cell">
            {id}
          </span>
          <span className="workbench-summary-title" role="cell">
            <h2>{title}</h2>
          </span>
          <span role="cell">{productLabel}</span>
          <span role="cell">{requestDepartment}</span>
          <span role="cell">{requester || "미기재"}</span>
          <span role="cell">
            <StatusBadge status={reviewStatus} />
          </span>
          <span role="cell">
            <RiskBadge level={riskLevel} />
          </span>
          <span role="cell">{deadline}</span>
          <span role="cell">{reviewer || "미배정"}</span>
        </div>
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
          {isFinalizingReview ? (
            <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
          ) : (
            <CircleCheck size={16} aria-hidden="true" />
          )}
          {isFinalizingReview ? "처리 중" : "승인"}
        </button>
        <button
          className="button detail-action-button detail-action-button--danger"
          type="button"
          data-active={reviewStatus === "rejected"}
          disabled={finalDecisionDisabled}
          onClick={() => onFinalizeReviewCase("reject")}
        >
          {isFinalizingReview ? (
            <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
          ) : (
            <CircleX size={16} aria-hidden="true" />
          )}
          {isFinalizingReview ? "처리 중" : "반려"}
        </button>
      </div>
    </section>
  );
}

function requestDepartmentFor({
  requester,
  productLabel
}: {
  requester: string;
  productLabel: string;
}): string {
  if (requester.includes("업로드")) return "디지털마케팅팀";
  if (productLabel === "카드") return "제휴마케팅팀";
  if (productLabel === "대출") return "리테일금융팀";
  return "마케팅팀";
}
