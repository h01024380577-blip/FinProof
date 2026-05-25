"use client";

import { useMemo, useState } from "react";
import { FilePenLine, MessageSquareText, RotateCw, Send } from "lucide-react";
import type { ReviewChatResponse } from "@/domain/chat";
import { riskLabels } from "@/domain/reviews";
import type { ReviewCase, ReviewIssue, RiskLevel } from "@/domain/types";
import { RiskBadge, StatusBadge } from "./Badges";

const riskOrder: RiskLevel[] = ["reject_recommended", "high", "caution", "info"];

type SavedDecision = {
  riskLevel: RiskLevel;
  comment: string;
};

export function ReviewDetailWorkspace({ review }: { review: ReviewCase }) {
  const [selectedIssueId, setSelectedIssueId] = useState(review.issues[0]?.id);
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const [draft, setDraft] = useState(review.currentDraft ?? review.expectedDraft);
  const [question, setQuestion] = useState("우대금리 조건을 어느 수준까지 표시해야 하나요?");
  const [chatResponsesByIssueId, setChatResponsesByIssueId] = useState<
    Record<string, ReviewChatResponse[]>
  >({});
  const [markedResponseIdsByIssueId, setMarkedResponseIdsByIssueId] = useState<
    Record<string, string[]>
  >({});
  const [reviewerRiskLevel, setReviewerRiskLevel] = useState<RiskLevel>(
    review.issues[0]?.reviewerRiskLevel ?? review.issues[0]?.riskLevel ?? "info"
  );
  const [reviewerComment, setReviewerComment] = useState("");
  const [savedDecisionsByIssueId, setSavedDecisionsByIssueId] = useState<
    Record<string, SavedDecision>
  >({});
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isSavingDecision, setIsSavingDecision] = useState(false);
  const selectedIssue: ReviewIssue | undefined =
    review.issues.find((issue) => issue.id === selectedIssueId) ?? review.issues[0];
  const chatResponses = selectedIssue ? (chatResponsesByIssueId[selectedIssue.id] ?? []) : [];
  const markedResponseIds = selectedIssue
    ? (markedResponseIdsByIssueId[selectedIssue.id] ?? [])
    : [];
  const savedDecision = selectedIssue ? (savedDecisionsByIssueId[selectedIssue.id] ?? null) : null;

  const visibleIssues = useMemo(
    () =>
      riskFilter === "all"
        ? review.issues
        : review.issues.filter((issue) => issue.riskLevel === riskFilter),
    [review.issues, riskFilter]
  );

  function selectIssue(issueId: string) {
    const nextIssue = review.issues.find((issue) => issue.id === issueId);
    const nextSavedDecision = nextIssue ? savedDecisionsByIssueId[nextIssue.id] : undefined;

    setSelectedIssueId(issueId);
    setReviewerRiskLevel(
      nextSavedDecision?.riskLevel ?? nextIssue?.reviewerRiskLevel ?? nextIssue?.riskLevel ?? "info"
    );
    setReviewerComment(nextSavedDecision?.comment ?? nextIssue?.reviewerComment ?? "");
  }

  async function handleAskQuestion() {
    if (!selectedIssue || question.trim().length === 0) {
      return;
    }

    const issueId = selectedIssue.id;

    setInteractionError(null);
    setIsAskingQuestion(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          issueId,
          question
        })
      });

      if (!apiResponse.ok) {
        throw new Error("질문 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as { response: ReviewChatResponse };

      setChatResponsesByIssueId((current) => ({
        ...current,
        [issueId]: [body.response, ...(current[issueId] ?? [])]
      }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "질문 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsAskingQuestion(false);
    }
  }

  function markLatestResponseForDraft() {
    if (!selectedIssue) {
      return;
    }

    const latestEvidenceResponse = chatResponses.find(
      (response) => response.answerType === "evidence_based"
    );

    if (!latestEvidenceResponse) {
      return;
    }

    const issueId = selectedIssue.id;

    setMarkedResponseIdsByIssueId((current) => {
      const currentIds = current[issueId] ?? [];

      if (currentIds.includes(latestEvidenceResponse.id)) {
        return current;
      }

      return {
        ...current,
        [issueId]: [latestEvidenceResponse.id, ...currentIds]
      };
    });
  }

  async function generateDraft() {
    const markedResponses = chatResponses.filter((response) =>
      markedResponseIds.includes(response.id)
    );

    setInteractionError(null);
    setIsGeneratingDraft(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markedResponses })
      });

      if (!apiResponse.ok) {
        throw new Error("의견 초안 생성 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as { draft: string };

      setDraft(body.draft);
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "의견 초안 생성 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsGeneratingDraft(false);
    }
  }

  async function saveReviewerDecision() {
    if (!selectedIssue) {
      return;
    }

    const issueId = selectedIssue.id;
    const finalAction = selectedIssue.suggestedAction;
    const trimmedComment = reviewerComment.trim();

    setInteractionError(null);
    setIsSavingDecision(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/issues/${issueId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewerRiskLevel,
          finalAction,
          reviewerComment: trimmedComment
        })
      });

      if (!apiResponse.ok) {
        throw new Error("판단 저장 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as { issue: ReviewIssue };

      setSavedDecisionsByIssueId((current) => ({
        ...current,
        [issueId]: {
          riskLevel: body.issue.reviewerRiskLevel ?? reviewerRiskLevel,
          comment: body.issue.reviewerComment ?? trimmedComment
        }
      }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "판단 저장 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsSavingDecision(false);
    }
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
          <button className="icon-button" type="button" title="분석 재실행">
            <RotateCw size={18} aria-hidden="true" />
          </button>
          <button className="button button--primary" type="button">
            최종 확정
          </button>
        </div>
      </section>

      <section className="detail__grid">
        <aside className="issue-panel">
          <div className="section-heading">
            <p className="eyebrow">Risk Candidates</p>
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
            {visibleIssues.length > 0 ? (
              visibleIssues.map((issue) => (
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
              ))
            ) : (
              <div className="issue-empty-state">
                <strong>추가 확인 필요</strong>
                <span>
                  {review.analysisNotice ??
                    "선택 가능한 AI 위험 후보가 없습니다. 업로드 자료와 근거를 추가 확인해 주세요."}
                </span>
              </div>
            )}
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
          isSavingDecision={isSavingDecision}
          onChangeRiskLevel={setReviewerRiskLevel}
          onChangeReviewerComment={setReviewerComment}
          onSaveReviewerDecision={saveReviewerDecision}
        />
      </section>

      <section className="bottom-grid">
        <div className="panel panel--compact">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Issue Query</p>
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
              disabled={!selectedIssue}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button
              className="icon-button"
              type="button"
              aria-label="질문 보내기"
              disabled={!selectedIssue || isAskingQuestion}
              onClick={handleAskQuestion}
            >
              <Send size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="chat-stack">
            {!selectedIssue ? (
              <div className="chat-answer chat-answer--empty">
                <p className="chat-answer__question">선택 가능한 이슈가 없습니다.</p>
                <p>
                  {review.analysisNotice ??
                    "선택 이슈가 생성된 후 근거 기반 질의를 사용할 수 있습니다."}
                </p>
              </div>
            ) : chatResponses.length === 0 ? (
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
            disabled={!selectedIssue}
            onClick={markLatestResponseForDraft}
          >
            의견 초안에 반영
          </button>
        </div>

        <div className="panel panel--compact">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Decision Draft</p>
              <h3>수정 요청 의견 초안</h3>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="수정 요청 의견 초안 생성"
              title="수정 요청 의견 초안 생성"
              disabled={isGeneratingDraft}
              onClick={generateDraft}
            >
              <FilePenLine size={18} aria-hidden="true" />
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

      {interactionError ? (
        <p className="interaction-error" role="alert">
          {interactionError}
        </p>
      ) : null}
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
  selectedIssue?: ReviewIssue;
  onSelectIssue: (id: string) => void;
}) {
  return (
    <section className="creative-viewer">
      <div className="section-heading">
        <p className="eyebrow">Document Viewer</p>
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
  isSavingDecision,
  onChangeRiskLevel,
  onChangeReviewerComment,
  onSaveReviewerDecision
}: {
  issue?: ReviewIssue;
  reviewerRiskLevel: RiskLevel;
  reviewerComment: string;
  savedDecision: { riskLevel: RiskLevel; comment: string } | null;
  isSavingDecision: boolean;
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
        <p className="eyebrow">Evidence</p>
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

        <button
          className="button"
          type="button"
          disabled={isSavingDecision}
          onClick={onSaveReviewerDecision}
        >
          {isSavingDecision ? "저장 중" : "판단 저장"}
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
