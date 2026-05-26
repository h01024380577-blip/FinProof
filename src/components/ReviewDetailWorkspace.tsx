"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Download,
  FilePenLine,
  MessageSquareText,
  Save,
  Send
} from "lucide-react";
import type { ReviewChatResponse } from "@/domain/chat";
import type { ReviewReport } from "@/domain/reports";
import { productLabels, riskLabels, statusLabels } from "@/domain/reviews";
import type { ReviewCase, ReviewIssue, RiskLevel, RoleId } from "@/domain/types";
import { useRoleContext } from "./RoleContext";
import { WorkbenchHeader } from "./workbench/WorkbenchHeader";
import { IssueList } from "./workbench/IssueList";
import { CreativeViewer } from "./workbench/CreativeViewer";
import { IssueDetailTabs, type IssueDetailTabKey } from "./workbench/IssueDetailTabs";
import { WorkbenchDrawer } from "./workbench/WorkbenchDrawer";

type SavedDecision = {
  riskLevel: RiskLevel;
  finalAction: NonNullable<ReviewIssue["finalAction"]>;
  comment: string;
};

type AnalysisStatusResponse = {
  reviewCaseId: string;
  status: "queued" | "running" | "completed" | "failed" | "not_started";
  progress: number;
  currentStep: string;
  jobId: string | null;
};

type AuditEvent = {
  id: string;
  action: string;
  targetType: string;
  targetId?: string;
  userId: string;
  createdAt: string;
};

type AuditEventsResponse = {
  auditEvents: AuditEvent[];
};

const finalActionStatusMap: Record<
  NonNullable<ReviewIssue["finalAction"]>,
  ReviewCase["status"]
> = {
  approve: "approved",
  change_request: "change_requested",
  reject: "rejected",
  hold: "on_hold"
};

const finalActionPriority: Array<NonNullable<ReviewIssue["finalAction"]>> = [
  "reject",
  "hold",
  "change_request",
  "approve"
];

const analysisStatusLabels: Record<AnalysisStatusResponse["status"], string> = {
  not_started: "분석 전",
  queued: "대기 중",
  running: "진행 중",
  completed: "완료",
  failed: "실패"
};

function formatAuditTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function canMutateReview(role: RoleId) {
  return role === "reviewer" || role === "compliance_admin";
}

function getFinalReviewAction(
  decisionsByIssueId: Record<string, SavedDecision>
): NonNullable<ReviewIssue["finalAction"]> | null {
  const finalActions = Object.values(decisionsByIssueId).map((decision) => decision.finalAction);

  return finalActionPriority.find((action) => finalActions.includes(action)) ?? null;
}

function getFinalReviewStatus(
  finalAction: NonNullable<ReviewIssue["finalAction"]> | null
): ReviewCase["status"] | null {
  return finalAction ? finalActionStatusMap[finalAction] : null;
}

function getInitialSavedDecisions(review: ReviewCase): Record<string, SavedDecision> {
  return Object.fromEntries(
    review.issues
      .filter((issue) => issue.finalAction && issue.reviewerRiskLevel)
      .map((issue) => [
        issue.id,
        {
          riskLevel: issue.reviewerRiskLevel ?? issue.riskLevel,
          finalAction: issue.finalAction ?? issue.suggestedAction,
          comment: issue.reviewerComment ?? ""
        }
      ])
  );
}

export function ReviewDetailWorkspace({
  review,
  loadSupportData = false
}: {
  review: ReviewCase;
  loadSupportData?: boolean;
}): JSX.Element {
  const roleContext = useRoleContext();
  const activeRole = roleContext?.activeRole ?? "reviewer";
  const roleHeaders = useMemo(() => ({ "x-finproof-role": activeRole }), [activeRole]);
  const jsonHeaders = useMemo(
    () => ({ ...roleHeaders, "content-type": "application/json" }),
    [roleHeaders]
  );
  const reviewerCanMutate = canMutateReview(activeRole);
  const [reviewStatus, setReviewStatus] = useState<ReviewCase["status"]>(review.status);
  const [selectedIssueId, setSelectedIssueId] = useState(review.issues[0]?.id);
  const [draft, setDraftState] = useState(review.currentDraft ?? review.expectedDraft);
  const latestDraftRef = useRef(draft);
  const [draftVersion, setDraftVersion] = useState(review.currentDraftVersion ?? 0);
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
  const [selectedFinalAction, setSelectedFinalAction] = useState<
    NonNullable<ReviewIssue["finalAction"]>
  >(review.issues[0]?.finalAction ?? review.issues[0]?.suggestedAction ?? "change_request");
  const [savedDecisionsByIssueId, setSavedDecisionsByIssueId] = useState<
    Record<string, SavedDecision>
  >(() => getInitialSavedDecisions(review));
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSavingDecision, setIsSavingDecision] = useState(false);
  const [isFinalizingReview, setIsFinalizingReview] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatusResponse | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [supportDataError, setSupportDataError] = useState<string | null>(null);
  const [finalizedNotice, setFinalizedNotice] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const selectedIssue: ReviewIssue | undefined =
    review.issues.find((issue) => issue.id === selectedIssueId) ?? review.issues[0];
  const chatResponses = selectedIssue ? (chatResponsesByIssueId[selectedIssue.id] ?? []) : [];
  const markedResponseIds = selectedIssue
    ? (markedResponseIdsByIssueId[selectedIssue.id] ?? [])
    : [];
  const savedDecision = selectedIssue ? (savedDecisionsByIssueId[selectedIssue.id] ?? null) : null;
  const finalReviewAction = getFinalReviewAction(savedDecisionsByIssueId);
  const finalReviewStatus = getFinalReviewStatus(finalReviewAction);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawTab = searchParams?.get("tab") ?? null;
  const initialTab: IssueDetailTabKey =
    rawTab === "evidence" || rawTab === "opinion" ? rawTab : "checklist";
  const [activeTab, setActiveTabState] = useState<IssueDetailTabKey>(initialTab);

  function setActiveTab(next: IssueDetailTabKey): void {
    setActiveTabState(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "checklist") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const query = params.toString();
    router.replace(query.length > 0 ? `${pathname}?${query}` : (pathname ?? ""));
  }

  useEffect(() => {
    if (!loadSupportData) {
      return;
    }

    let isMounted = true;

    async function loadReviewSupportData() {
      setSupportDataError(null);
      try {
        const [statusResponse, auditResponse] = await Promise.all([
          fetch(`/api/v1/review-cases/${review.id}/analysis/status`, { headers: roleHeaders }),
          fetch(`/api/v1/review-cases/${review.id}/audit-events`, { headers: roleHeaders })
        ]);

        if (!statusResponse?.ok || !auditResponse?.ok) {
          throw new Error("support data fetch failed");
        }

        const [statusBody, auditBody] = await Promise.all([
          statusResponse.json() as Promise<AnalysisStatusResponse>,
          auditResponse.json() as Promise<AuditEventsResponse>
        ]);

        if (isMounted) {
          setAnalysisStatus(statusBody);
          setAuditEvents(auditBody.auditEvents);
        }
      } catch {
        if (isMounted) {
          setSupportDataError("분석 상태와 감사 로그를 불러오지 못했습니다.");
        }
      }
    }

    void loadReviewSupportData();

    return () => {
      isMounted = false;
    };
  }, [loadSupportData, review.id, roleHeaders]);

  function setDraft(nextDraft: string) {
    latestDraftRef.current = nextDraft;
    setDraftState(nextDraft);
  }

  function selectIssue(issueId: string) {
    const nextIssue = review.issues.find((issue) => issue.id === issueId);
    const nextSavedDecision = nextIssue ? savedDecisionsByIssueId[nextIssue.id] : undefined;

    setSelectedIssueId(issueId);
    setReviewerRiskLevel(
      nextSavedDecision?.riskLevel ?? nextIssue?.reviewerRiskLevel ?? nextIssue?.riskLevel ?? "info"
    );
    setSelectedFinalAction(
      nextSavedDecision?.finalAction ??
        nextIssue?.finalAction ??
        nextIssue?.suggestedAction ??
        "change_request"
    );
    setReviewerComment(nextSavedDecision?.comment ?? nextIssue?.reviewerComment ?? "");
    setFinalizedNotice(null);
    setReportNotice(null);
    setDraftNotice(null);
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
        headers: jsonHeaders,
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
    if (!selectedIssue || !reviewerCanMutate) {
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
    if (!reviewerCanMutate) {
      return;
    }

    const markedResponses = chatResponses.filter((response) =>
      markedResponseIds.includes(response.id)
    );

    setInteractionError(null);
    setIsGeneratingDraft(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/draft`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ markedResponses })
      });

      if (!apiResponse.ok) {
        throw new Error("의견 초안 생성 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as { draft: string; version?: number };

      setDraft(body.draft);
      setDraftNotice(null);
      if (typeof body.version === "number") {
        setDraftVersion(body.version);
      }
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "의견 초안 생성 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsGeneratingDraft(false);
    }
  }

  async function saveDraftVersion() {
    if (!reviewerCanMutate) {
      return;
    }

    const submittedDraft = draft;
    const trimmedDraft = submittedDraft.trim();
    setDraftNotice(null);

    if (trimmedDraft.length === 0) {
      setInteractionError("저장할 의견 초안을 입력해 주세요.");
      return;
    }

    setInteractionError(null);
    setIsSavingDraft(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/draft`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ draft: trimmedDraft })
      });

      if (!apiResponse.ok) {
        throw new Error("의견 초안 저장 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as { draft: string; version: number };
      const hasLocalEditAfterSaveRequest = latestDraftRef.current !== submittedDraft;

      setDraftVersion(body.version);
      if (!hasLocalEditAfterSaveRequest) {
        setDraft(body.draft);
        setDraftNotice(`의견 초안 v${body.version} 저장됨.`);
      }
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "의견 초안 저장 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function generateReportDownload() {
    if (!reviewerCanMutate) {
      return;
    }

    const reportType =
      savedDecision?.finalAction ??
      selectedIssue?.suggestedAction ??
      finalReviewAction ??
      "change_request";
    const issueIds = selectedIssue ? [selectedIssue.id] : review.issues.map((issue) => issue.id);

    setInteractionError(null);
    setReportNotice(null);
    setIsGeneratingReport(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/reports/generate`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          reportType,
          tone: "formal",
          includeChatContext: true,
          issueIds,
          draft
        })
      });

      if (!apiResponse.ok) {
        throw new Error("리포트 생성 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as ReviewReport;
      const blob = new Blob([body.contentMarkdown], { type: "text/markdown;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = href;
      link.download = `${body.reportId}.md`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setReportNotice("Markdown 리포트 다운로드를 준비했습니다.");
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "리포트 생성 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsGeneratingReport(false);
    }
  }

  async function saveReviewerDecision() {
    if (!selectedIssue || !reviewerCanMutate) {
      return;
    }

    const issueId = selectedIssue.id;
    const finalAction = selectedFinalAction;
    const trimmedComment = reviewerComment.trim();

    setInteractionError(null);
    setIsSavingDecision(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/issues/${issueId}`, {
        method: "PATCH",
        headers: jsonHeaders,
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
          finalAction: body.issue.finalAction ?? finalAction,
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

  async function finalizeReviewCase() {
    if (!finalReviewAction || !finalReviewStatus || !reviewerCanMutate) {
      return;
    }

    setInteractionError(null);
    setFinalizedNotice(null);
    setIsFinalizingReview(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/finalize`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ finalAction: finalReviewAction })
      });

      if (!apiResponse.ok) {
        throw new Error("최종 확정 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as {
        reviewCase: Pick<ReviewCase, "status">;
      };

      setReviewStatus(body.reviewCase.status);
      setFinalizedNotice(`최종 상태가 ${statusLabels[body.reviewCase.status]}으로 저장되었습니다.`);
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "최종 확정 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsFinalizingReview(false);
    }
  }

  // Inner drawer panel JSX — preserve existing chat/draft/audit/files markup verbatim.
  const chatPanel = (
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
          disabled={!selectedIssue || !reviewerCanMutate}
          onClick={markLatestResponseForDraft}
        >
          초안에 반영
        </button>
      </div>
  );

  const draftPanel = (
    <div className="panel panel--compact">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Decision Draft</p>
            <h3>
              수정 요청 의견 초안
              {draftVersion > 0 ? <span className="draft-version">v{draftVersion}</span> : null}
            </h3>
          </div>
          <div className="draft-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="의견 초안 저장"
              title="의견 초안 저장"
              disabled={!reviewerCanMutate || isSavingDraft}
              onClick={saveDraftVersion}
            >
              <Save size={18} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="리포트 다운로드"
              title="리포트 다운로드"
              disabled={!reviewerCanMutate || isGeneratingReport}
              onClick={generateReportDownload}
            >
              <Download size={18} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="초안 재생성"
              title="초안 재생성"
              disabled={!reviewerCanMutate || isGeneratingDraft}
              onClick={generateDraft}
            >
              <FilePenLine size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <textarea
          className="draft-editor"
          value={draft}
          aria-label="Opinion draft"
          disabled={!reviewerCanMutate}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftNotice(null);
          }}
        />
      </div>
  );

  const auditPanel = (
    <div className="panel panel--compact drawer-support-panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Audit Trail</p>
            <h3>감사 로그</h3>
          </div>
        </div>
        <div className="analysis-status-summary">
          <strong>
            {analysisStatus
              ? `${analysisStatusLabels[analysisStatus.status]} · ${analysisStatus.progress}%`
              : "분석 상태 확인 전"}
          </strong>
          {analysisStatus?.currentStep ? <span>{analysisStatus.currentStep}</span> : null}
        </div>
        {supportDataError ? (
          <p className="support-data-error" role="alert">
            {supportDataError}
          </p>
        ) : null}
        <ol className="audit-list">
          {auditEvents.length > 0 ? (
            auditEvents.map((event) => (
              <li key={event.id}>
                {event.action} · {event.userId}
                <span>{formatAuditTime(event.createdAt)}</span>
              </li>
            ))
          ) : (
            <li>감사 이벤트 없음</li>
          )}
        </ol>
      </div>
  );

  const filesPanel = (
    <div className="panel panel--compact drawer-support-panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Files</p>
          <h3>파일</h3>
        </div>
      </div>
      <div className="drawer-file-list">
        {review.files.map((file) => (
          <span key={file.id}>{file.name}</span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="detail">
      <WorkbenchHeader
        id={review.id}
        title={review.title}
        statusLabel={statusLabels[reviewStatus]}
        riskLabel={riskLabels[review.highestRiskLevel]}
        productLabel={productLabels[review.productType]}
        reviewer={review.reviewer}
        deadline={review.plannedPublishDate}
        canMutate={reviewerCanMutate}
        selectedAction={selectedFinalAction}
        isGeneratingDraft={isGeneratingDraft}
        onSelectAction={setSelectedFinalAction}
        onGenerateDraft={generateDraft}
      />

      <section className="detail__grid">
        <IssueList
          issues={review.issues}
          selectedIssueId={selectedIssue?.id}
          onSelectIssue={selectIssue}
          analysisNotice={review.analysisNotice}
        />

        <CreativeViewer
          copy={review.promotionalCopy}
          disclosure={review.disclosure}
          issues={review.issues}
          selectedIssueId={selectedIssue?.id}
          onSelectIssue={selectIssue}
        />

        {selectedIssue ? (
          <IssueDetailTabs
            issue={selectedIssue}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            reviewerRiskLevel={reviewerRiskLevel}
            reviewerComment={reviewerComment}
            savedDecision={savedDecision}
            canMutate={reviewerCanMutate}
            canFinalize={Boolean(finalReviewStatus)}
            isSavingDecision={isSavingDecision}
            isFinalizingReview={isFinalizingReview}
            onChangeRiskLevel={setReviewerRiskLevel}
            onChangeReviewerComment={setReviewerComment}
            onSaveReviewerDecision={saveReviewerDecision}
            onFinalizeReviewCase={finalizeReviewCase}
          />
        ) : null}
      </section>

      <WorkbenchDrawer
        defaultCollapsed={activeRole === "requester"}
        chatNode={chatPanel}
        draftNode={draftPanel}
        auditNode={auditPanel}
        filesNode={filesPanel}
      />

      {interactionError ? (
        <p className="interaction-error" role="alert">
          {interactionError}
        </p>
      ) : null}
      {finalizedNotice ? <p className="finalized-notice">{finalizedNotice}</p> : null}
      {draftNotice ? <p className="draft-notice">{draftNotice}</p> : null}
      {reportNotice ? <p className="report-notice">{reportNotice}</p> : null}
    </div>
  );
}
