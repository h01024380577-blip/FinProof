"use client";

import type { JSX, ReactNode } from "react";
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

type EvidenceDisplayItem = Evidence & {
  sourceLabel?: string;
  hideMetadata?: boolean;
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

function evidenceSourceLabel(sourceType: Evidence["sourceType"]): string {
  const labels: Record<Evidence["sourceType"], string> = {
    law: "법령",
    internal_policy: "내부 기준",
    product_doc: "업로드 자료",
    case_history: "과거 심의 사례"
  };

  return labels[sourceType];
}

function normalizeArticleReference(value: string): string {
  const trimmed = value.replace(/\s+/g, "").trim();

  return trimmed.startsWith("제") ? trimmed : `제${trimmed}`;
}

function articleReferenceFromQuote(value: string): string | undefined {
  const match = value.match(/(?:제)?\d+조(?:\s*제?\d+항)?(?:\s*제?\d+호)?/);

  return match ? normalizeArticleReference(match[0]) : undefined;
}

function isTableOfContentsQuote(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  const hasTocMarker = /목\s*차|contents/i.test(normalized);
  const hasDotLeader = /[·.]{2,}|(?:·\s*){3,}/.test(normalized);
  const hasSectionHeadingList = /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.\s*\S+/.test(normalized);

  return hasTocMarker && (hasDotLeader || hasSectionHeadingList);
}

function displayEvidenceQuote(evidence: Evidence): string {
  if (
    (evidence.sourceType === "law" || evidence.sourceType === "internal_policy") &&
    isTableOfContentsQuote(evidence.quoteSummary)
  ) {
    return "등록된 지식문서의 조항 본문을 기준으로 판단했습니다.";
  }

  return evidence.quoteSummary
    .replace(/(?:\s*[·.]\s*){4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceCitation(evidence: Evidence): string {
  const section = evidence.section?.trim() || articleReferenceFromQuote(evidence.quoteSummary);
  const location = section ? ` ${section}` : "";

  return `${evidence.title}${location}`;
}

function fallbackEvidenceForIssue(issue: ReviewIssue): EvidenceDisplayItem {
  return {
    id: `${issue.id}-analysis-fallback-evidence`,
    sourceType: "product_doc",
    sourceLabel: "AI 분석 결과",
    title: "AI 분석 결과",
    quoteSummary: issue.description || issue.suggestedCopy || issue.targetText,
    relevanceScore: issue.confidence ?? 1,
    hideMetadata: true
  };
}

function isRegulatoryEvidence(evidence: Evidence) {
  return evidence.sourceType === "law" || evidence.sourceType === "internal_policy";
}

function EvidenceCard({ evidence }: { evidence: EvidenceDisplayItem }): JSX.Element {
  return (
    <article className="evidence-card">
      <span>{evidence.sourceLabel ?? evidenceSourceLabel(evidence.sourceType)}</span>
      <div className="evidence-card__source">
        <small>참고 출처</small>
        <strong className="evidence-card__title">{evidenceCitation(evidence)}</strong>
      </div>
      <div className="evidence-card__reason">
        <small>판단 근거</small>
        <p className="evidence-card__quote">{displayEvidenceQuote(evidence)}</p>
      </div>
      {evidence.hideMetadata ? null : <small>{formatEvidenceMetadata(evidence)}</small>}
    </article>
  );
}

function EvidenceSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="evidence-section" aria-label={title}>
      <h4>{title}</h4>
      <div className="evidence-section__body">{children}</div>
    </section>
  );
}

function EvidencePanel({ issue }: { issue: ReviewIssue }): JSX.Element {
  const evidenceItems: EvidenceDisplayItem[] =
    issue.evidence.length > 0 ? issue.evidence : [fallbackEvidenceForIssue(issue)];
  const adEvidence = evidenceItems.filter((evidence) => evidence.sourceType === "product_doc");
  const regulatoryEvidence = evidenceItems.filter(isRegulatoryEvidence);
  const caseHistoryEvidence = evidenceItems.filter(
    (evidence) => evidence.sourceType === "case_history"
  );
  const needsRegulatoryReview = adEvidence.length > 0 && regulatoryEvidence.length === 0;

  return (
    <div className="evidence-stack">
      <EvidenceSection title="규정/내규 근거">
        {regulatoryEvidence.length > 0 ? (
          regulatoryEvidence.map((evidence) => (
            <EvidenceCard key={evidence.id} evidence={evidence} />
          ))
        ) : (
          <p className="evidence-empty-state">연결된 승인 지식문서 없음</p>
        )}
      </EvidenceSection>

      {caseHistoryEvidence.length > 0 ? (
        <EvidenceSection title="과거 심의 참고">
          {caseHistoryEvidence.map((evidence) => (
            <EvidenceCard key={evidence.id} evidence={evidence} />
          ))}
        </EvidenceSection>
      ) : null}

      {needsRegulatoryReview ? (
        <p className="evidence-status-message">
          현재 이슈는 업로드 광고 표현을 기준으로 AI가 위험 신호를 판단했으며, 적용 규정/내규 근거는
          리뷰어 확인이 필요합니다.
        </p>
      ) : null}
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
