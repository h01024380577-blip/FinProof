"use client";

import type { JSX } from "react";
import { LoaderCircle } from "lucide-react";
import { Tabs } from "@/components/ui";
import { RiskBadge } from "@/components/Badges";
import { riskLabels } from "@/domain/reviews";
import type { Evidence, ReviewIssue, RiskLevel } from "@/domain/types";

export type IssueDetailTabKey = "checklist" | "evidence" | "opinion";

export type IssueDetailTabsProps = {
  issue: ReviewIssue;
  activeTab: IssueDetailTabKey;
  onTabChange: (tab: IssueDetailTabKey) => void;
  reviewerRiskLevel: RiskLevel;
  reviewerComment: string;
  savedDecision: { riskLevel: RiskLevel; comment: string } | null;
  canMutate: boolean;
  isSavingDecision: boolean;
  onChangeRiskLevel: (riskLevel: RiskLevel) => void;
  onChangeReviewerComment: (comment: string) => void;
  onSaveReviewerDecision: () => void;
};

export function IssueDetailTabs(props: IssueDetailTabsProps): JSX.Element {
  const { issue, activeTab, onTabChange } = props;

  return (
    <aside className="evidence-panel">
      <Tabs
        activeKey={activeTab}
        onChange={(key) => onTabChange(key as IssueDetailTabKey)}
        ariaLabel="이슈 상세 탭"
        items={[
          { key: "checklist", label: "체크리스트", panel: <ChecklistPanel issue={issue} /> },
          { key: "evidence", label: "근거 자료", panel: <EvidencePanel issue={issue} /> },
          { key: "opinion", label: "의견서", panel: <OpinionPanel {...props} /> }
        ]}
      />
    </aside>
  );
}

function ChecklistPanel({ issue }: { issue: ReviewIssue }): JSX.Element {
  return (
    <div className="evidence-panel__summary">
      <RiskBadge level={issue.riskLevel} />
      <h4>{issue.title}</h4>
      <p>{issue.description}</p>
      <MultilingualContextBlock issue={issue} />
      <div className="suggested-copy">
        <span>수정 제안</span>
        <p>{issue.suggestedCopy}</p>
      </div>
    </div>
  );
}

function MultilingualContextBlock({ issue }: { issue: ReviewIssue }): JSX.Element | null {
  const context = issue.multilingualContext;

  if (!context) {
    return null;
  }

  return (
    <section className="multilingual-context" aria-label="다국어 심의 맥락">
      <dl>
        <div>
          <dt>원문 표현</dt>
          <dd className="multilingual-context__original-text">{context.originalText}</dd>
        </div>
        <div>
          <dt>심의상 의미</dt>
          <dd>{context.complianceMeaning}</dd>
        </div>
        <div>
          <dt>리스크 신호</dt>
          <dd>
            <ul>
              {context.riskSignals.map((riskSignal) => (
                <li key={riskSignal}>{riskSignal}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>국내 기준 매핑</dt>
          <dd>
            <strong>{context.koreanComplianceCategory}</strong>
            <span>{context.koreanComplianceReason}</span>
          </dd>
        </div>
        <div>
          <dt>원문 수정안</dt>
          <dd>{context.suggestedCopyOriginalLanguage}</dd>
        </div>
      </dl>
    </section>
  );
}

function formatEvidenceMetadata(evidence: Evidence): string {
  const parts: string[] = [];

  if (typeof evidence.page === "number") {
    parts.push(`${evidence.page}쪽`);
  }

  const section = evidence.section?.trim();
  if (section) {
    parts.push(section);
  }

  parts.push(`관련도 ${Math.round(evidence.relevanceScore * 100)}%`);

  return parts.join(" · ");
}

function EvidencePanel({ issue }: { issue: ReviewIssue }): JSX.Element {
  return (
    <div className="evidence-stack">
      {issue.evidence.map((evidence) => (
        <article key={evidence.id} className="evidence-card">
          <span>{evidence.sourceType}</span>
          <strong className="evidence-card__title">{evidence.title}</strong>
          <p className="evidence-card__quote">{evidence.quoteSummary}</p>
          <small>{formatEvidenceMetadata(evidence)}</small>
        </article>
      ))}
    </div>
  );
}

function OpinionPanel({
  reviewerRiskLevel,
  reviewerComment,
  savedDecision,
  canMutate,
  isSavingDecision,
  onChangeRiskLevel,
  onChangeReviewerComment,
  onSaveReviewerDecision
}: IssueDetailTabsProps): JSX.Element {
  return (
    <div className="reviewer-decision">
      <label htmlFor="reviewer-risk-level">심의자 위험도</label>
      <select
        id="reviewer-risk-level"
        aria-label="심의자 위험도"
        value={reviewerRiskLevel}
        disabled={!canMutate}
        onChange={(event) => onChangeRiskLevel(event.target.value as RiskLevel)}
      >
        <option value="info">참고</option>
        <option value="caution">주의</option>
        <option value="high">위험</option>
        <option value="reject_recommended">반려 권고</option>
      </select>

      <label htmlFor="reviewer-comment">심의자 메모</label>
      <textarea
        id="reviewer-comment"
        aria-label="심의자 메모"
        value={reviewerComment}
        disabled={!canMutate}
        onChange={(event) => onChangeReviewerComment(event.target.value)}
      />

      <button
        className="button"
        type="button"
        disabled={!canMutate || isSavingDecision}
        onClick={onSaveReviewerDecision}
      >
        {isSavingDecision ? (
          <>
            <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
            저장 중
          </>
        ) : (
          "위험도 변경"
        )}
      </button>

      {savedDecision ? (
        <div className="saved-decision">
          <strong>저장된 판단: {riskLabels[savedDecision.riskLevel]}</strong>
          {savedDecision.comment ? <p>{savedDecision.comment}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
