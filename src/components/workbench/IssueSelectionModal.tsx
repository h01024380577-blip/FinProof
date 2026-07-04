"use client";

import { useMemo, useState, type JSX } from "react";
import { LoaderCircle, X } from "lucide-react";
import { riskLabels } from "@/domain/reviews";
import type { ReviewIssue, RiskLevel } from "@/domain/types";
import { issueAgentBadges } from "./agent-badges";
import styles from "./IssueSelectionModal.module.css";

const riskOrder: RiskLevel[] = ["high", "caution", "info"];
const riskRank: Record<RiskLevel, number> = { high: 0, caution: 1, info: 2 };

export type IssueSelectionModalProps = {
  issues: ReviewIssue[];
  onConfirm: (selectedIssueIds: string[]) => void | Promise<void>;
  onClose: () => void;
  isGenerating: boolean;
};

export function IssueSelectionModal({
  issues,
  onConfirm,
  onClose,
  isGenerating
}: IssueSelectionModalProps): JSX.Element {
  // Default state: every issue selected, matching the prior "all issues" behavior.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(issues.map((issue) => issue.id))
  );
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");

  const visible = useMemo(() => {
    const filtered =
      riskFilter === "all" ? issues : issues.filter((issue) => issue.riskLevel === riskFilter);

    // Sort by risk severity descending (위험 → 주의 → 참고). Array.prototype.sort is
    // stable, so same-risk issues keep their original order.
    return [...filtered].sort((a, b) => riskRank[a.riskLevel] - riskRank[b.riskLevel]);
  }, [issues, riskFilter]);

  const allVisibleSelected =
    visible.length > 0 && visible.every((issue) => selectedIds.has(issue.id));

  function toggleIssue(issueId: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) {
        visible.forEach((issue) => next.delete(issue.id));
      } else {
        visible.forEach((issue) => next.add(issue.id));
      }
      return next;
    });
  }

  function handleConfirm() {
    if (selectedIds.size === 0 || isGenerating) {
      return;
    }
    // Preserve the original issue order for the selected ids.
    const orderedIds = issues.filter((issue) => selectedIds.has(issue.id)).map((issue) => issue.id);
    void onConfirm(orderedIds);
  }

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <section
        className={`panel ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        aria-label="초안 생성 이슈 선택"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <p className="eyebrow">Draft Issues</p>
            <h3>초안에 반영할 이슈 선택</h3>
          </div>
          <button
            className="icon-button icon-button--small"
            type="button"
            aria-label="이슈 선택 닫기"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.toolbar}>
          <div className="filter-row" aria-label="Risk filters">
            <button
              className="chip"
              data-active={riskFilter === "all"}
              type="button"
              onClick={() => setRiskFilter("all")}
            >
              전체
            </button>
            {riskOrder.map((level) => (
              <button
                key={level}
                className="chip"
                data-active={riskFilter === level}
                type="button"
                onClick={() => setRiskFilter(level)}
              >
                {riskLabels[level]}
              </button>
            ))}
          </div>
          <button
            className="button button--small"
            type="button"
            disabled={visible.length === 0}
            onClick={toggleAllVisible}
          >
            {allVisibleSelected ? "전체 해제" : "전체 선택"}
          </button>
        </div>

        <ul className={styles.list} aria-label="초안 이슈 선택 목록">
          {visible.length > 0 ? (
            visible.map((issue) => {
              const checked = selectedIds.has(issue.id);
              return (
                <li key={issue.id}>
                  <label className={styles.item} data-selected={checked}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isGenerating}
                      onChange={() => toggleIssue(issue.id)}
                      aria-label={`${issue.title} 선택`}
                    />
                    <span className={styles.itemBody}>
                      <span className={styles.itemTop}>
                        <small className={styles.itemRisk} data-risk={issue.riskLevel}>
                          {riskLabels[issue.riskLevel]}
                        </small>
                        {issueAgentBadges(issue).map((badge) => (
                          <small
                            key={badge.key}
                            className={`issue-card__agent-badge issue-agent-badge--${badge.tone}`}
                          >
                            {badge.listLabel}
                          </small>
                        ))}
                      </span>
                      <strong className={styles.itemTitle}>{issue.title}</strong>
                      <span className={styles.itemExcerpt}>{issue.targetText}</span>
                    </span>
                  </label>
                </li>
              );
            })
          ) : (
            <li className={styles.empty}>선택 가능한 이슈가 없습니다.</li>
          )}
        </ul>

        <div className={styles.footer}>
          <span className={styles.count}>{selectedIds.size}개 선택됨</span>
          <div className={styles.actions}>
            <button className="button" type="button" disabled={isGenerating} onClick={onClose}>
              취소
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={selectedIds.size === 0 || isGenerating}
              onClick={handleConfirm}
            >
              {isGenerating ? (
                <>
                  <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
                  생성 중
                </>
              ) : (
                "선택 이슈로 초안 생성"
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
