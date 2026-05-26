"use client";

import type { JSX } from "react";
import { AlertTriangle, FilePenLine } from "lucide-react";
import type { ReviewIssue } from "@/domain/types";

export type WorkbenchHeaderProps = {
  id: string;
  title: string;
  statusLabel: string;
  riskLabel: string;
  productLabel: string;
  reviewer: string;
  deadline: string;
  canMutate: boolean;
  selectedAction: NonNullable<ReviewIssue["finalAction"]>;
  isGeneratingDraft: boolean;
  onSelectAction: (action: NonNullable<ReviewIssue["finalAction"]>) => void;
  onGenerateDraft: () => void;
};

export function WorkbenchHeader({
  id,
  title,
  statusLabel,
  riskLabel,
  productLabel,
  reviewer,
  deadline,
  canMutate,
  selectedAction,
  isGeneratingDraft,
  onSelectAction,
  onGenerateDraft
}: WorkbenchHeaderProps): JSX.Element {
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
      <div className="detail__actions" role="group" aria-label="이슈 추천 조치">
        <span className="workbench-header__group-label" aria-hidden="true">
          이슈 추천 조치
        </span>
        <button
          className="button detail-action-button"
          type="button"
          data-active={selectedAction === "hold"}
          disabled={!canMutate}
          onClick={() => onSelectAction("hold")}
        >
          보류
        </button>
        <button
          className="button detail-action-button detail-action-button--danger"
          type="button"
          data-active={selectedAction === "reject"}
          disabled={!canMutate}
          onClick={() => onSelectAction("reject")}
        >
          반려
        </button>
        <button
          className="button detail-action-button"
          type="button"
          data-active={selectedAction === "change_request"}
          disabled={!canMutate}
          onClick={() => onSelectAction("change_request")}
        >
          수정 요청
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={!canMutate || isGeneratingDraft}
          onClick={onGenerateDraft}
        >
          <FilePenLine size={16} aria-hidden="true" />
          {isGeneratingDraft ? "생성 중" : "초안 생성"}
        </button>
      </div>
    </section>
  );
}
