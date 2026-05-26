"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent, JSX } from "react";
import {
  Activity,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  FileClock,
  FileText,
  Library,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type {
  ChatMessage,
  ChatMode,
  ChatSession,
  DraftVersion,
  Evidence,
  KnowledgeApprovalStatus,
  KnowledgeDocument,
  KnowledgeDocumentType,
  PersistedReviewReport,
  ProductType,
  ReviewIssue,
  ReviewSummary
} from "@/domain/types";
import { useRole } from "./RoleContext";

const productLabels: Record<ProductType, string> = {
  deposit: "예금/적금",
  loan: "대출",
  card: "카드",
  capital: "캐피탈",
  insurance: "보험",
  investment: "투자상품"
};

const documentTypeLabels: Record<KnowledgeDocumentType, string> = {
  law: "법규",
  internal_policy: "내부 기준",
  checklist: "체크리스트",
  guide: "가이드"
};

const approvalLabels: Record<KnowledgeApprovalStatus, string> = {
  draft: "승인 대기",
  approved: "승인됨",
  inactive: "비활성"
};

type KnowledgeDocumentsResponse = {
  documents: KnowledgeDocument[];
};

type CaseLibraryResponse = {
  items?: ReviewSummary[];
  reviewCases?: ReviewSummary[];
  page: number;
  pageSize: number;
  total: number;
};

type CreateChatMessageResponse = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
};

type AnalysisStatusResponse = {
  jobId?: string;
  status?: string;
  progress?: number;
  currentStep?: string;
  reviewCaseStatus?: string;
};

type AuditEventItem = {
  id: string;
  action: string;
  targetType: string;
  targetId?: string;
  userId: string;
  createdAt: string;
};

type DocumentFormState = {
  title: string;
  version: string;
  storageKey: string;
  documentType: KnowledgeDocumentType;
  productType: ProductType | "";
};

const initialDocumentForm: DocumentFormState = {
  title: "",
  version: "",
  storageKey: "",
  documentType: "internal_policy",
  productType: "deposit"
};

function formatDateTime(value?: string): string {
  if (!value) return "-";
  return value.replace("T", " ").replace(".000Z", "");
}

function responseError(message: string): Error {
  return new Error(message);
}

async function parseJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    throw responseError(fallbackMessage);
  }

  return (await response.json()) as T;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function OperationsConsole(): JSX.Element {
  const { activeRole, apiHeaders } = useRole();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [caseLibrary, setCaseLibrary] = useState<ReviewSummary[]>([]);
  const [caseTotal, setCaseTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documentForm, setDocumentForm] = useState<DocumentFormState>(initialDocumentForm);
  const [isCreatingDocument, setIsCreatingDocument] = useState(false);
  const [reviewCaseId, setReviewCaseId] = useState("");
  const [issueId, setIssueId] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("issue");
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatusResponse | null>(null);
  const [issues, setIssues] = useState<ReviewIssue[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [draftVersion, setDraftVersion] = useState<DraftVersion | null>(null);
  const [report, setReport] = useState<PersistedReviewReport | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const markedAssistantMessages = useMemo(
    () => chatMessages.filter((message) => message.role === "assistant" && message.markedForDraft),
    [chatMessages]
  );
  const selectedReviewCaseId = reviewCaseId.trim();
  const selectedIssueId = issueId.trim();
  const hasReviewCaseId = selectedReviewCaseId.length > 0;
  const hasIssueId = selectedIssueId.length > 0;
  const latestAssistantMessage = useMemo(
    () => [...chatMessages].reverse().find((message) => message.role === "assistant"),
    [chatMessages]
  );
  const evidenceIds = useMemo(
    () =>
      uniqueStrings([
        ...evidence.map((item) => item.id),
        ...chatMessages.flatMap((m) => m.evidenceIds)
      ]),
    [chatMessages, evidence]
  );

  useEffect(() => {
    let mounted = true;

    async function loadConsoleData(): Promise<void> {
      setIsLoading(true);
      setError(null);
      try {
        const [documentResponse, libraryResponse] = await Promise.all([
          fetch("/api/v1/knowledge-documents", {
            headers: apiHeaders()
          }),
          fetch("/api/v1/case-library?page=1&pageSize=5", {
            headers: apiHeaders()
          })
        ]);
        const documentBody = await parseJson<KnowledgeDocumentsResponse>(
          documentResponse,
          "지식 문서를 불러오지 못했습니다."
        );
        const libraryBody = await parseJson<CaseLibraryResponse>(
          libraryResponse,
          "사례 라이브러리를 불러오지 못했습니다."
        );

        if (!mounted) return;
        setDocuments(documentBody.documents);
        setCaseLibrary(libraryBody.items ?? libraryBody.reviewCases ?? []);
        setCaseTotal(libraryBody.total);
      } catch (loadError) {
        if (!mounted) return;
        setError(
          loadError instanceof Error ? loadError.message : "운영 콘솔 데이터를 불러오지 못했습니다."
        );
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadConsoleData();

    return () => {
      mounted = false;
    };
  }, [activeRole, apiHeaders]);

  async function createKnowledgeDocument(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsCreatingDocument(true);
    setError(null);
    setActionMessage(null);

    try {
      const response = await fetch("/api/v1/knowledge-documents", {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          title: documentForm.title,
          version: documentForm.version,
          storageKey: documentForm.storageKey,
          documentType: documentForm.documentType,
          productType: documentForm.productType || undefined
        })
      });
      const body = await parseJson<{ document: KnowledgeDocument }>(
        response,
        "지식 문서를 등록하지 못했습니다."
      );

      setDocuments((current) => [body.document, ...current]);
      setDocumentForm(initialDocumentForm);
      setActionMessage("지식 문서가 등록되었습니다.");
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "지식 문서를 등록하지 못했습니다."
      );
    } finally {
      setIsCreatingDocument(false);
    }
  }

  async function approveDocument(documentId: string): Promise<void> {
    setError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/v1/knowledge-documents/${documentId}/approve`, {
        method: "POST",
        headers: apiHeaders()
      });
      const body = await parseJson<{ document: KnowledgeDocument }>(
        response,
        "지식 문서를 승인하지 못했습니다."
      );

      setDocuments((current) =>
        current.map((document) => (document.id === documentId ? body.document : document))
      );
      setActionMessage("지식 문서가 승인되었습니다.");
    } catch (approveError) {
      setError(
        approveError instanceof Error ? approveError.message : "지식 문서를 승인하지 못했습니다."
      );
    }
  }

  async function createChatSession(): Promise<void> {
    if (!hasReviewCaseId) {
      setError("심의 ID를 입력해 주세요.");
      return;
    }

    setError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/v1/review-cases/${selectedReviewCaseId}/chat/sessions`, {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          mode: chatMode,
          issueId: selectedIssueId || undefined
        })
      });
      const body = await parseJson<{ session: ChatSession }>(
        response,
        "채팅 세션을 생성하지 못했습니다."
      );

      setChatSession(body.session);
      setChatMessages([]);
      setActionMessage("채팅 세션이 생성되었습니다.");
    } catch (sessionError) {
      setError(
        sessionError instanceof Error ? sessionError.message : "채팅 세션을 생성하지 못했습니다."
      );
    }
  }

  async function sendChatMessage(): Promise<void> {
    if (!chatSession) {
      setError("먼저 채팅 세션을 생성해 주세요.");
      return;
    }

    setError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/v1/chat/sessions/${chatSession.id}/messages`, {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ content: chatQuestion })
      });
      const body = await parseJson<CreateChatMessageResponse>(
        response,
        "채팅 메시지를 전송하지 못했습니다."
      );

      setChatMessages((current) => [...current, body.userMessage, body.assistantMessage]);
      setChatQuestion("");
      setActionMessage("채팅 응답이 저장되었습니다.");
    } catch (messageError) {
      setError(
        messageError instanceof Error ? messageError.message : "채팅 메시지를 전송하지 못했습니다."
      );
    }
  }

  async function markLatestMessageForDraft(): Promise<void> {
    if (!latestAssistantMessage) {
      setError("초안에 반영할 assistant 메시지가 없습니다.");
      return;
    }

    setError(null);
    setActionMessage(null);

    try {
      const response = await fetch(
        `/api/v1/chat/messages/${latestAssistantMessage.id}/mark-for-draft`,
        {
          method: "POST",
          headers: apiHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ markedForDraft: true })
        }
      );
      const body = await parseJson<{ message: ChatMessage }>(
        response,
        "메시지를 초안 반영 대상으로 표시하지 못했습니다."
      );

      setChatMessages((current) =>
        current.map((message) => (message.id === body.message.id ? body.message : message))
      );
      setActionMessage("assistant 메시지가 초안 반영 대상으로 표시되었습니다.");
    } catch (markError) {
      setError(
        markError instanceof Error
          ? markError.message
          : "메시지를 초안 반영 대상으로 표시하지 못했습니다."
      );
    }
  }

  async function saveDraftVersion(): Promise<void> {
    if (!hasReviewCaseId) {
      setError("심의 ID를 입력해 주세요.");
      return;
    }

    setError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/v1/review-cases/${selectedReviewCaseId}/draft/versions`, {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          source: "generated",
          sourceMessageIds: markedAssistantMessages.map((message) => message.id),
          evidenceIds,
          draft:
            markedAssistantMessages.length > 0
              ? markedAssistantMessages.map((message) => message.content).join("\n")
              : undefined
        })
      });
      const body = await parseJson<{ draftVersion: DraftVersion }>(
        response,
        "초안 버전을 저장하지 못했습니다."
      );

      setDraftVersion(body.draftVersion);
      setActionMessage("초안 버전이 저장되었습니다.");
    } catch (draftError) {
      setError(
        draftError instanceof Error ? draftError.message : "초안 버전을 저장하지 못했습니다."
      );
    }
  }

  async function saveReport(): Promise<void> {
    if (!hasReviewCaseId) {
      setError("심의 ID를 입력해 주세요.");
      return;
    }

    setError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/v1/review-cases/${selectedReviewCaseId}/reports`, {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          reportType: "change_request",
          tone: "formal",
          includeChatContext: true,
          issueIds: uniqueStrings([selectedIssueId, ...issues.map((issue) => issue.id)]),
          draft: draftVersion?.draft
        })
      });
      const body = await parseJson<{ report: PersistedReviewReport }>(
        response,
        "리포트를 저장하지 못했습니다."
      );

      setReport(body.report);
      setActionMessage("검토 리포트가 저장되었습니다.");
    } catch (reportError) {
      setError(
        reportError instanceof Error ? reportError.message : "리포트를 저장하지 못했습니다."
      );
    }
  }

  async function loadAnalysisStatus(): Promise<void> {
    if (!hasReviewCaseId) {
      setError("심의 ID를 입력해 주세요.");
      return;
    }

    setError(null);
    try {
      const response = await fetch(`/api/v1/review-cases/${selectedReviewCaseId}/analysis/status`, {
        headers: apiHeaders()
      });
      const body = await parseJson<AnalysisStatusResponse>(
        response,
        "분석 상태를 조회하지 못했습니다."
      );

      setAnalysisStatus(body);
    } catch (statusError) {
      setError(
        statusError instanceof Error ? statusError.message : "분석 상태를 조회하지 못했습니다."
      );
    }
  }

  async function loadIssues(): Promise<void> {
    if (!hasReviewCaseId) {
      setError("심의 ID를 입력해 주세요.");
      return;
    }

    setError(null);
    try {
      const response = await fetch(`/api/v1/review-cases/${selectedReviewCaseId}/issues`, {
        headers: apiHeaders()
      });
      const body = await parseJson<{ issues: ReviewIssue[] }>(
        response,
        "이슈 목록을 조회하지 못했습니다."
      );

      setIssues(body.issues);
    } catch (issueError) {
      setError(
        issueError instanceof Error ? issueError.message : "이슈 목록을 조회하지 못했습니다."
      );
    }
  }

  async function loadEvidence(): Promise<void> {
    if (!hasIssueId) {
      setError("이슈 ID를 입력해 주세요.");
      return;
    }

    setError(null);
    try {
      const response = await fetch(`/api/v1/issues/${selectedIssueId}/evidence`, {
        headers: apiHeaders()
      });
      const body = await parseJson<{ evidence: Evidence[] }>(
        response,
        "근거 목록을 조회하지 못했습니다."
      );

      setEvidence(body.evidence);
    } catch (evidenceError) {
      setError(
        evidenceError instanceof Error ? evidenceError.message : "근거 목록을 조회하지 못했습니다."
      );
    }
  }

  async function loadAuditEvents(): Promise<void> {
    if (!hasReviewCaseId) {
      setError("심의 ID를 입력해 주세요.");
      return;
    }

    setError(null);
    try {
      const response = await fetch(`/api/v1/review-cases/${selectedReviewCaseId}/audit-events`, {
        headers: apiHeaders()
      });
      const body = await parseJson<{ auditEvents: AuditEventItem[] }>(
        response,
        "감사 이벤트를 조회하지 못했습니다."
      );

      setAuditEvents(body.auditEvents);
    } catch (auditError) {
      setError(
        auditError instanceof Error ? auditError.message : "감사 이벤트를 조회하지 못했습니다."
      );
    }
  }

  return (
    <div className="operations-console">
      <section className="queue-head operations-console__head">
        <div>
          <h2>운영 콘솔</h2>
          <p>Product V1 백엔드 운영 API를 프론트에서 직접 확인하고 관리합니다.</p>
        </div>
        <div className="operations-console__role">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{activeRole}</span>
        </div>
      </section>

      {error ? (
        <p className="interaction-error" role="alert">
          {error}
        </p>
      ) : null}
      {actionMessage ? <p className="operations-console__notice">{actionMessage}</p> : null}

      <section className="operations-console__grid">
        <article className="panel operations-panel operations-panel--knowledge">
          <div className="panel__header operations-panel__header">
            <div>
              <span className="operations-panel__eyebrow">
                <BookOpenCheck size={15} aria-hidden="true" />
                Knowledge
              </span>
              <h3>지식 문서</h3>
            </div>
            {isLoading ? <Loader2 size={16} aria-hidden="true" /> : null}
          </div>

          <form
            className="operations-form"
            onSubmit={(event) => void createKnowledgeDocument(event)}
          >
            <label className="operations-field">
              <span>문서 제목</span>
              <input
                aria-label="문서 제목"
                value={documentForm.title}
                onChange={(event) =>
                  setDocumentForm((current) => ({ ...current, title: event.target.value }))
                }
                required
              />
            </label>
            <label className="operations-field">
              <span>버전</span>
              <input
                aria-label="버전"
                value={documentForm.version}
                onChange={(event) =>
                  setDocumentForm((current) => ({ ...current, version: event.target.value }))
                }
                required
              />
            </label>
            <label className="operations-field">
              <span>저장 키</span>
              <input
                aria-label="저장 키"
                value={documentForm.storageKey}
                onChange={(event) =>
                  setDocumentForm((current) => ({ ...current, storageKey: event.target.value }))
                }
                required
              />
            </label>
            <label className="operations-field">
              <span>문서 유형</span>
              <select
                aria-label="문서 유형"
                value={documentForm.documentType}
                onChange={(event) =>
                  setDocumentForm((current) => ({
                    ...current,
                    documentType: event.target.value as KnowledgeDocumentType
                  }))
                }
              >
                {Object.entries(documentTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="operations-field">
              <span>상품군</span>
              <select
                aria-label="문서 상품군"
                value={documentForm.productType}
                onChange={(event) =>
                  setDocumentForm((current) => ({
                    ...current,
                    productType: event.target.value as ProductType | ""
                  }))
                }
              >
                <option value="">전체</option>
                {Object.entries(productLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button className="button button--primary" type="submit" disabled={isCreatingDocument}>
              <CheckCircle2 size={16} aria-hidden="true" />
              문서 등록
            </button>
          </form>

          <div className="operations-list" aria-label="지식 문서 목록">
            {documents.length === 0 ? (
              <p className="operations-empty">등록된 지식 문서가 없습니다.</p>
            ) : null}
            {documents.map((document) => (
              <div className="operations-list__item" key={document.id}>
                <div>
                  <strong>{document.title}</strong>
                  <span>
                    {documentTypeLabels[document.documentType]} · {document.version} ·{" "}
                    {document.productType ? productLabels[document.productType] : "전체"}
                  </span>
                </div>
                <div className="operations-list__actions">
                  <span className="status-badge">{approvalLabels[document.approvalStatus]}</span>
                  {document.approvalStatus === "draft" ? (
                    <button
                      className="button button--small"
                      type="button"
                      onClick={() => void approveDocument(document.id)}
                    >
                      승인
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel operations-panel">
          <div className="panel__header operations-panel__header">
            <div>
              <span className="operations-panel__eyebrow">
                <Library size={15} aria-hidden="true" />
                Case Library
              </span>
              <h3>사례 라이브러리</h3>
            </div>
            <span className="operations-count">{caseTotal}</span>
          </div>

          <div className="operations-list" aria-label="사례 라이브러리 목록">
            {caseLibrary.length === 0 ? (
              <p className="operations-empty">완료된 사례가 없습니다.</p>
            ) : null}
            {caseLibrary.map((review) => (
              <div className="operations-list__item" key={review.id}>
                <div>
                  <strong>{review.title}</strong>
                  <span>
                    {review.id} · {productLabels[review.productType]} · {review.affiliate}
                  </span>
                </div>
                <span className="risk-badge" data-risk={review.highestRiskLevel}>
                  {review.highestRiskLevel}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel operations-panel operations-workbench">
        <div className="panel__header operations-panel__header">
          <div>
            <span className="operations-panel__eyebrow">
              <Activity size={15} aria-hidden="true" />
              Review Operations
            </span>
            <h3>심의 운영 작업</h3>
          </div>
        </div>

        <div className="operations-workbench__controls">
          <label className="operations-field">
            <span>심의 ID</span>
            <input
              aria-label="심의 ID"
              value={reviewCaseId}
              onChange={(event) => setReviewCaseId(event.target.value)}
              placeholder="rc-demo-deposit-001"
            />
          </label>
          <label className="operations-field">
            <span>이슈 ID</span>
            <input
              aria-label="이슈 ID"
              value={issueId}
              onChange={(event) => setIssueId(event.target.value)}
              placeholder="issue-deposit-rate"
            />
          </label>
          <label className="operations-field">
            <span>채팅 모드</span>
            <select
              aria-label="채팅 모드"
              value={chatMode}
              onChange={(event) => setChatMode(event.target.value as ChatMode)}
            >
              <option value="issue">이슈</option>
              <option value="case">심의 건</option>
              <option value="similar_case">유사 사례</option>
              <option value="draft">초안</option>
            </select>
          </label>
        </div>

        <div className="operations-action-grid">
          <div className="operations-action-card">
            <div className="operations-action-card__header">
              <Activity size={16} aria-hidden="true" />
              <strong>상태·이슈·근거·감사</strong>
            </div>
            <div className="operations-button-row">
              <button
                className="button button--small"
                type="button"
                disabled={!hasReviewCaseId}
                onClick={() => void loadAnalysisStatus()}
              >
                <RefreshCw size={15} aria-hidden="true" />
                상태 조회
              </button>
              <button
                className="button button--small"
                type="button"
                disabled={!hasReviewCaseId}
                onClick={() => void loadIssues()}
              >
                <ClipboardList size={15} aria-hidden="true" />
                이슈 조회
              </button>
              <button
                className="button button--small"
                type="button"
                disabled={!hasIssueId}
                onClick={() => void loadEvidence()}
              >
                <FileText size={15} aria-hidden="true" />
                근거 조회
              </button>
              <button
                className="button button--small"
                type="button"
                disabled={!hasReviewCaseId}
                onClick={() => void loadAuditEvents()}
              >
                <FileClock size={15} aria-hidden="true" />
                감사 이벤트 조회
              </button>
            </div>

            <div className="operations-result-grid">
              <div>
                <span className="operations-result-label">분석 상태</span>
                {analysisStatus ? (
                  <dl className="operations-kv">
                    <div>
                      <dt>Job</dt>
                      <dd>{analysisStatus.jobId ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{analysisStatus.status ?? analysisStatus.reviewCaseStatus ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>Step</dt>
                      <dd>{analysisStatus.currentStep ?? "-"}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="operations-empty">조회 전</p>
                )}
              </div>
              <div>
                <span className="operations-result-label">이슈</span>
                {issues.length === 0 ? (
                  <p className="operations-empty">조회된 이슈가 없습니다.</p>
                ) : null}
                {issues.slice(0, 4).map((issue) => (
                  <p className="operations-mini-row" key={issue.id}>
                    <strong>{issue.title}</strong>
                    <span>{issue.id}</span>
                  </p>
                ))}
              </div>
              <div>
                <span className="operations-result-label">근거</span>
                {evidence.length === 0 ? (
                  <p className="operations-empty">조회된 근거가 없습니다.</p>
                ) : null}
                {evidence.slice(0, 4).map((item) => (
                  <p className="operations-mini-row" key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.quoteSummary}</span>
                  </p>
                ))}
              </div>
              <div>
                <span className="operations-result-label">감사 이벤트</span>
                {auditEvents.length === 0 ? (
                  <p className="operations-empty">조회된 이벤트가 없습니다.</p>
                ) : null}
                {auditEvents.slice(0, 4).map((event) => (
                  <p className="operations-mini-row" key={event.id}>
                    <strong>{event.action}</strong>
                    <span>
                      {event.targetType} · {formatDateTime(event.createdAt)}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          </div>

          <div className="operations-action-card">
            <div className="operations-action-card__header">
              <MessageSquare size={16} aria-hidden="true" />
              <strong>지속형 채팅·초안·리포트</strong>
            </div>
            <div className="operations-button-row">
              <button
                className="button button--small"
                type="button"
                disabled={!hasReviewCaseId}
                onClick={() => void createChatSession()}
              >
                <MessageSquare size={15} aria-hidden="true" />
                세션 생성
              </button>
              <button
                className="button button--small"
                type="button"
                disabled={!latestAssistantMessage}
                onClick={() => void markLatestMessageForDraft()}
              >
                <Sparkles size={15} aria-hidden="true" />
                초안 반영 표시
              </button>
              <button
                className="button button--small"
                type="button"
                disabled={!hasReviewCaseId}
                onClick={() => void saveDraftVersion()}
              >
                <FileText size={15} aria-hidden="true" />
                초안 버전 저장
              </button>
              <button
                className="button button--small"
                type="button"
                disabled={!hasReviewCaseId}
                onClick={() => void saveReport()}
              >
                <FileClock size={15} aria-hidden="true" />
                리포트 저장
              </button>
            </div>

            <label className="operations-field operations-field--wide">
              <span>세션 질문</span>
              <textarea
                aria-label="세션 질문"
                value={chatQuestion}
                onChange={(event) => setChatQuestion(event.target.value)}
                placeholder="이슈 근거나 수정 문안을 질문하세요."
              />
            </label>
            <button
              className="button button--primary"
              type="button"
              disabled={!chatSession || chatQuestion.trim().length === 0}
              onClick={() => void sendChatMessage()}
            >
              <Send size={16} aria-hidden="true" />
              메시지 전송
            </button>

            <div className="operations-chat-log" aria-label="지속형 채팅 메시지">
              {chatSession ? (
                <p className="operations-mini-row">
                  <strong>{chatSession.id}</strong>
                  <span>{chatSession.mode}</span>
                </p>
              ) : (
                <p className="operations-empty">채팅 세션이 없습니다.</p>
              )}
              {chatMessages.map((message) => (
                <p className="operations-chat-message" data-role={message.role} key={message.id}>
                  <span>{message.role}</span>
                  {message.content}
                </p>
              ))}
            </div>

            <div className="operations-result-grid operations-result-grid--two">
              <div>
                <span className="operations-result-label">초안 버전</span>
                {draftVersion ? (
                  <p className="operations-mini-row">
                    <strong>{draftVersion.id}</strong>
                    <span>v{draftVersion.version}</span>
                  </p>
                ) : (
                  <p className="operations-empty">저장 전</p>
                )}
              </div>
              <div>
                <span className="operations-result-label">리포트</span>
                {report ? (
                  <p className="operations-mini-row">
                    <strong>{report.id}</strong>
                    <span>v{report.version}</span>
                  </p>
                ) : (
                  <p className="operations-empty">저장 전</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
