"use client";

import { useMemo, useState } from "react";
import { MessageSquareText, RotateCw, Send, WandSparkles } from "lucide-react";
import {
  answerReviewQuestion,
  generateDraftWithChatContext,
  type ReviewChatResponse
} from "@/domain/chat";
import { riskLabels } from "@/domain/reviews";
import type { ReviewCase, ReviewIssue, RiskLevel } from "@/domain/types";
import { RiskBadge, StatusBadge } from "./Badges";

const riskOrder: RiskLevel[] = ["reject_recommended", "high", "caution", "info"];

export function ReviewDetailWorkspace({ review }: { review: ReviewCase }) {
  const [selectedIssueId, setSelectedIssueId] = useState(review.issues[0]?.id);
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const [draft, setDraft] = useState(review.expectedDraft);
  const [question, setQuestion] = useState("우대금리 조건을 어느 수준까지 표시해야 하나요?");
  const [chatResponses, setChatResponses] = useState<ReviewChatResponse[]>([]);
  const [markedResponseIds, setMarkedResponseIds] = useState<string[]>([]);
  const [reviewerRiskLevel, setReviewerRiskLevel] = useState<RiskLevel>(
    review.issues[0]?.reviewerRiskLevel ?? review.issues[0]?.riskLevel ?? "info"
  );
  const [reviewerComment, setReviewerComment] = useState("");
  const [savedDecision, setSavedDecision] = useState<{
    riskLevel: RiskLevel;
    comment: string;
  } | null>(null);
  const selectedIssue =
    review.issues.find((issue) => issue.id === selectedIssueId) ?? review.issues[0];

  const visibleIssues = useMemo(
    () =>
      riskFilter === "all"
        ? review.issues
        : review.issues.filter((issue) => issue.riskLevel === riskFilter),
    [review.issues, riskFilter]
  );

  function selectIssue(issueId: string) {
    const nextIssue = review.issues.find((issue) => issue.id === issueId);

    setSelectedIssueId(issueId);
    setReviewerRiskLevel(nextIssue?.reviewerRiskLevel ?? nextIssue?.riskLevel ?? "info");
    setReviewerComment("");
    setSavedDecision(null);
  }

  function handleAskQuestion() {
    if (!selectedIssue || question.trim().length === 0) {
      return;
    }

    const response = answerReviewQuestion({
      review,
      issue: selectedIssue,
      question
    });

    setChatResponses((current) => [response, ...current]);
  }

  function markLatestResponseForDraft() {
    const latestEvidenceResponse = chatResponses.find(
      (response) => response.answerType === "evidence_based"
    );

    if (!latestEvidenceResponse) {
      return;
    }

    setMarkedResponseIds((current) =>
      current.includes(latestEvidenceResponse.id)
        ? current
        : [latestEvidenceResponse.id, ...current]
    );
  }

  function generateDraft() {
    const markedResponses = chatResponses.filter((response) =>
      markedResponseIds.includes(response.id)
    );

    setDraft(generateDraftWithChatContext(review, markedResponses));
  }

  function saveReviewerDecision() {
    setSavedDecision({
      riskLevel: reviewerRiskLevel,
      comment: reviewerComment.trim()
    });
  }

  return (
    <div className="detail">
      <section className="detail__header">
        <div>
          <p className="eyebrow">{review.id}</p>
          <h2>{review.title}</h2>
          <p className="detail__meta">
            {review.affiliate} · {review.channelType.join(", ")} · 게시 예정{" "}
            {review.plannedPublishDate}
          </p>
        </div>
        <div className="detail__actions">
          <StatusBadge status={review.status} />
          <RiskBadge level={review.highestRiskLevel} />
          <button className="icon-button" type="button" title="Re-run Analysis">
            <RotateCw size={18} aria-hidden="true" />
          </button>
          <button className="button button--primary" type="button">
            Finalize
          </button>
        </div>
      </section>

      <section className="detail__grid">
        <aside className="issue-panel">
          <div className="section-heading">
            <p className="eyebrow">Agent Findings</p>
            <h3>이슈 목록</h3>
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

          <div className="issue-list">
            {visibleIssues.map((issue) => (
              <button
                key={issue.id}
                className="issue-card"
                data-active={selectedIssue?.id === issue.id}
                type="button"
                onClick={() => selectIssue(issue.id)}
              >
                <span className="issue-card__top">
                  <RiskBadge level={issue.riskLevel} />
                  <small>{issue.issueType}</small>
                </span>
                <strong>{issue.title}</strong>
                <span>{issue.targetText}</span>
              </button>
            ))}
          </div>
        </aside>

        <CreativeViewer
          copy={review.promotionalCopy}
          disclosure={review.disclosure}
          issues={review.issues}
          selectedIssue={selectedIssue}
          onSelectIssue={selectIssue}
        />

        <EvidencePanel
          issue={selectedIssue}
          reviewerRiskLevel={reviewerRiskLevel}
          reviewerComment={reviewerComment}
          savedDecision={savedDecision}
          onChangeRiskLevel={setReviewerRiskLevel}
          onChangeReviewerComment={setReviewerComment}
          onSaveReviewerDecision={saveReviewerDecision}
        />
      </section>

      <section className="bottom-grid">
        <div className="panel panel--compact">
          <div className="panel__header">
            <div>
              <p className="eyebrow">RAG Chat</p>
              <h3>선택 이슈 기반 질의</h3>
            </div>
            <MessageSquareText size={20} aria-hidden="true" />
          </div>
          <div className="chat-composer">
            <label className="sr-only" htmlFor="rag-question">
              RAG question
            </label>
            <input
              id="rag-question"
              value={question}
              aria-label="RAG question"
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button
              className="icon-button"
              type="button"
              aria-label="질문 보내기"
              onClick={handleAskQuestion}
            >
              <Send size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="chat-stack">
            {chatResponses.length === 0 ? (
              <div className="chat-answer">
                <p className="chat-answer__question">
                  우대금리 조건을 어느 수준까지 표시해야 하나요?
                </p>
                <p>
                  현재 근거상 조건부 혜택임을 본문 또는 인접 고지에서 명확히 표시하는 수정이
                  필요합니다.
                </p>
                <div className="evidence-inline">
                  {selectedIssue?.evidence.slice(0, 2).map((evidence) => (
                    <span key={evidence.id}>{evidence.title}</span>
                  ))}
                </div>
              </div>
            ) : (
              chatResponses.map((response) => (
                <article
                  key={response.id}
                  className="chat-answer"
                  data-answer-type={response.answerType}
                >
                  <p className="chat-answer__question">{response.question}</p>
                  <p>{response.content}</p>
                  {response.requiredMaterials.length > 0 ? (
                    <div className="evidence-inline">
                      {response.requiredMaterials.map((material) => (
                        <span key={material}>{material}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="evidence-inline">
                      {response.evidence.slice(0, 2).map((evidence) => (
                        <span key={evidence.id}>{evidence.title}</span>
                      ))}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>

          <button
            className="button chat-mark-button"
            type="button"
            onClick={markLatestResponseForDraft}
          >
            의견 초안에 반영
          </button>
        </div>

        <div className="panel panel--compact">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Opinion Draft</p>
              <h3>수정 요청 의견 초안</h3>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="수정 요청 의견 초안 생성"
              title="수정 요청 의견 초안 생성"
              onClick={generateDraft}
            >
              <WandSparkles size={18} aria-hidden="true" />
            </button>
          </div>
          <textarea
            className="draft-editor"
            value={draft}
            aria-label="Opinion draft"
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </section>
    </div>
  );
}

function CreativeViewer({
  copy,
  disclosure,
  issues,
  selectedIssue,
  onSelectIssue
}: {
  copy: string;
  disclosure: string;
  issues: ReviewIssue[];
  selectedIssue: ReviewIssue;
  onSelectIssue: (id: string) => void;
}) {
  return (
    <section className="creative-viewer">
      <div className="section-heading">
        <p className="eyebrow">Creative Viewer</p>
        <h3>홍보물 시안</h3>
      </div>
      <div className="poster">
        <div className="poster__copy">{copy}</div>
        <p>{disclosure}</p>
        {issues.map((issue) => {
          const [left, top, width, height] = issue.targetBbox;

          return (
            <button
              key={issue.id}
              className="highlight-box"
              data-risk={issue.riskLevel}
              data-active={selectedIssue?.id === issue.id}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`
              }}
              type="button"
              title={issue.title}
              onClick={() => onSelectIssue(issue.id)}
            >
              <span>{riskLabels[issue.riskLevel]}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EvidencePanel({
  issue,
  reviewerRiskLevel,
  reviewerComment,
  savedDecision,
  onChangeRiskLevel,
  onChangeReviewerComment,
  onSaveReviewerDecision
}: {
  issue?: ReviewIssue;
  reviewerRiskLevel: RiskLevel;
  reviewerComment: string;
  savedDecision: { riskLevel: RiskLevel; comment: string } | null;
  onChangeRiskLevel: (riskLevel: RiskLevel) => void;
  onChangeReviewerComment: (comment: string) => void;
  onSaveReviewerDecision: () => void;
}) {
  if (!issue) {
    return null;
  }

  return (
    <aside className="evidence-panel">
      <div className="section-heading">
        <p className="eyebrow">Evidence Panel</p>
        <h3>근거 패널</h3>
      </div>
      <div className="evidence-panel__summary">
        <RiskBadge level={issue.riskLevel} />
        <h4>{issue.title}</h4>
        <p>{issue.description}</p>
      </div>

      <div className="evidence-stack">
        {issue.evidence.map((evidence) => (
          <article key={evidence.id} className="evidence-card">
            <span>{evidence.sourceType}</span>
            <strong>{evidence.title}</strong>
            <p>{evidence.quoteSummary}</p>
            <small>
              p.{evidence.page ?? "-"} · {evidence.section} · relevance{" "}
              {Math.round(evidence.relevanceScore * 100)}%
            </small>
          </article>
        ))}
      </div>

      <div className="suggested-copy">
        <span>수정 제안</span>
        <p>{issue.suggestedCopy}</p>
      </div>

      <div className="reviewer-decision">
        <label htmlFor="reviewer-risk-level">Reviewer risk level</label>
        <select
          id="reviewer-risk-level"
          aria-label="Reviewer risk level"
          value={reviewerRiskLevel}
          onChange={(event) => onChangeRiskLevel(event.target.value as RiskLevel)}
        >
          <option value="info">참고</option>
          <option value="caution">주의</option>
          <option value="high">위험</option>
          <option value="reject_recommended">반려 권고</option>
        </select>

        <label htmlFor="reviewer-comment">Reviewer comment</label>
        <textarea
          id="reviewer-comment"
          aria-label="Reviewer comment"
          value={reviewerComment}
          onChange={(event) => onChangeReviewerComment(event.target.value)}
        />

        <button className="button" type="button" onClick={onSaveReviewerDecision}>
          판단 저장
        </button>

        {savedDecision ? (
          <div className="saved-decision">
            <strong>저장된 판단: {riskLabels[savedDecision.riskLevel]}</strong>
            {savedDecision.comment ? <p>{savedDecision.comment}</p> : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
