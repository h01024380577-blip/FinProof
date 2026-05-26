"use client";

import { useMemo, useState, type CSSProperties, type JSX } from "react";
import { riskLabels } from "@/domain/reviews";
import type { ReviewIssue, RiskLevel } from "@/domain/types";

const riskOrder: RiskLevel[] = ["reject_recommended", "high", "caution", "info"];

function displayLength(value: string): number {
  return Array.from(value).reduce((total, character) => {
    return total + (/^[\u0020-\u007e]$/.test(character) ? 0.55 : 1);
  }, 0);
}

function issueCardStyle(issue: ReviewIssue): CSSProperties {
  const titleLines = Math.max(1, Math.ceil(displayLength(issue.title) / 23));
  const excerptLines = Math.max(1, Math.ceil(displayLength(issue.targetText) / 28));
  const minHeight = Math.min(188, Math.max(108, 50 + titleLines * 20 + excerptLines * 18));

  return {
    "--issue-card-min-height": `${minHeight}px`
  } as CSSProperties;
}

export type IssueListProps = {
  issues: ReviewIssue[];
  selectedIssueId?: string;
  onSelectIssue: (issueId: string) => void;
  analysisNotice?: string;
};

export function IssueList({
  issues,
  selectedIssueId,
  onSelectIssue,
  analysisNotice
}: IssueListProps): JSX.Element {
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const visible = useMemo(
    () => (riskFilter === "all" ? issues : issues.filter((i) => i.riskLevel === riskFilter)),
    [issues, riskFilter]
  );

  return (
    <aside className="issue-panel">
      <div className="issue-panel__heading">
        <h3>이슈 목록 ({issues.length})</h3>
      </div>

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

      <div className="issue-list" aria-label="이슈 목록 스크롤 영역">
        {visible.length > 0 ? (
          visible.map((issue, index) => (
            <button
              key={issue.id}
              className="issue-card"
              data-active={selectedIssueId === issue.id}
              data-risk={issue.riskLevel}
              style={issueCardStyle(issue)}
              type="button"
              onClick={() => onSelectIssue(issue.id)}
            >
              <span className="issue-card__content">
                <span className="issue-card__top">
                  <small className="issue-card__index">#{index + 1}</small>
                </span>
                <strong className="issue-card__title">{issue.title}</strong>
                <span className="issue-card__excerpt">{issue.targetText}</span>
              </span>
            </button>
          ))
        ) : (
          <div className="issue-empty-state">
            <strong>추가 확인 필요</strong>
            <span>
              {analysisNotice ??
                "선택 가능한 AI 위험 후보가 없습니다. 업로드 자료와 근거를 추가 확인해 주세요."}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
