"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX
} from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  AlertTriangle,
  Download,
  FilePenLine,
  LoaderCircle,
  MessageCircle,
  RotateCw,
  Save,
  Send,
  X
} from "lucide-react";
import { chatProgressLabel } from "@/domain/chat";
import type { ChatProgressEvent, ReviewChatResponse } from "@/domain/chat";
import type { ReviewReport } from "@/domain/reports";
import { productLabels, statusLabels } from "@/domain/reviews";
import type { ReviewCase, ReviewIssue, ReviewVersion, RiskLevel, RoleId } from "@/domain/types";
import type { RevisionDiff } from "@/domain/revision-diff";
import { useRoleContext } from "./RoleContext";
import { AnalysisProgressPopup } from "@/components/analysis/AnalysisProgressPopup";
import { WorkbenchHeader } from "./workbench/WorkbenchHeader";
import type { FinalDecisionAction } from "./workbench/WorkbenchHeader";
import { IssueList } from "./workbench/IssueList";
import { CreativeViewer } from "./workbench/CreativeViewer";
import { IssueDetailTabs, type IssueDetailTabKey } from "./workbench/IssueDetailTabs";
import { WorkbenchDrawer } from "./workbench/WorkbenchDrawer";
import { CertificateEditor, type CertificateDraft } from "./workbench/CertificateEditor";
import { ManualIssueForm, type ManualIssueInput } from "./workbench/ManualIssueForm";
import { VersionHistoryPanel } from "./workbench/VersionHistoryPanel";
import styles from "./ReviewDetailWorkspace.module.css";

type SavedDecision = {
  riskLevel: RiskLevel;
  finalAction: NonNullable<ReviewIssue["finalAction"]>;
  comment: string;
};

type PendingQuestion = {
  issueId: string;
  question: string;
};

type ChatResponsesByIssueId = Record<string, ReviewChatResponse[]>;
type ChatResponsesByReviewId = Record<string, ChatResponsesByIssueId>;

type ChatContentBlock =
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "list";
      items: string[];
    };

type InlineSegment = {
  text: string;
  strong: boolean;
};

const finalActionPriority: Array<NonNullable<ReviewIssue["finalAction"]>> = [
  "reject",
  "hold",
  "change_request",
  "approve"
];
const NOTICE_AUTO_DISMISS_MS = 4000;
const CHAT_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const CHAT_HISTORY_STORAGE_PREFIX = "finproof.review-chat-history.v1";

const finalDecisionConfirmPhrases: Record<FinalDecisionAction, string> = {
  approve: "승인으로",
  reject: "반려로"
};

function canMutateReview(role: RoleId) {
  return role === "reviewer" || role === "compliance_admin";
}

function chatContentBlocks(content: string): ChatContentBlock[] {
  const blocks: ChatContentBlock[] = [];
  const lines = content.split(/\r?\n/);
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  function flushParagraph() {
    const text = paragraphLines.join(" ").replace(/\s+/g, " ").trim();

    if (text.length > 0) {
      blocks.push({ type: "paragraph", text });
    }

    paragraphLines = [];
  }

  function flushList() {
    if (listItems.length > 0) {
      blocks.push({ type: "list", items: listItems });
    }

    listItems = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks.length > 0 ? blocks : [{ type: "paragraph", text: content }];
}

function inlineSegments(text: string): InlineSegment[] {
  return text.split(/(\*\*[^*]+\*\*)/g).flatMap((part): InlineSegment[] => {
    if (part.length === 0) {
      return [];
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return [{ text: part.slice(2, -2), strong: true }];
    }

    return [{ text: part, strong: false }];
  });
}

function FormattedChatContent({ content }: { content: string }): JSX.Element {
  return (
    <div className="chat-response-body">
      {chatContentBlocks(content).map((block, blockIndex) => {
        if (block.type === "list") {
          return (
            <ul key={`list-${blockIndex}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${blockIndex}-${itemIndex}`} aria-label={item}>
                  {inlineSegments(item).map((segment, segmentIndex) =>
                    segment.strong ? (
                      <strong key={segmentIndex}>{segment.text}</strong>
                    ) : (
                      <span key={segmentIndex}>{segment.text}</span>
                    )
                  )}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`paragraph-${blockIndex}`}>
            {inlineSegments(block.text).map((segment, segmentIndex) =>
              segment.strong ? (
                <strong key={segmentIndex}>{segment.text}</strong>
              ) : (
                <span key={segmentIndex}>{segment.text}</span>
              )
            )}
          </p>
        );
      })}
    </div>
  );
}

function getFinalReviewAction(
  decisionsByIssueId: Record<string, SavedDecision>
): NonNullable<ReviewIssue["finalAction"]> | null {
  const finalActions = Object.values(decisionsByIssueId).map((decision) => decision.finalAction);

  return finalActionPriority.find((action) => finalActions.includes(action)) ?? null;
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

function chatHistoryStorageKey(reviewCaseId: string): string {
  return `${CHAT_HISTORY_STORAGE_PREFIX}.${reviewCaseId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReviewChatResponse(value: unknown): value is ReviewChatResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.question === "string" &&
    typeof value.content === "string" &&
    (value.answerType === "evidence_based" || value.answerType === "insufficient_evidence") &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.requiredMaterials)
  );
}

function hasStoredChatResponses(responsesByIssueId: ChatResponsesByIssueId): boolean {
  return Object.values(responsesByIssueId).some((responses) => responses.length > 0);
}

function normalizeStoredChatResponses(value: unknown): ChatResponsesByIssueId {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([issueId, responses]) => {
      if (!Array.isArray(responses)) {
        return [];
      }

      const validResponses = responses.filter(isReviewChatResponse);

      return validResponses.length > 0 ? [[issueId, validResponses]] : [];
    })
  );
}

function loadCachedChatResponses(reviewCaseId: string): ChatResponsesByIssueId {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const storageKey = chatHistoryStorageKey(reviewCaseId);
    const rawCache = window.localStorage.getItem(storageKey);

    if (!rawCache) {
      return {};
    }

    const parsed = JSON.parse(rawCache) as unknown;

    if (!isRecord(parsed) || typeof parsed.expiresAt !== "number") {
      window.localStorage.removeItem(storageKey);
      return {};
    }

    if (parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(storageKey);
      return {};
    }

    return normalizeStoredChatResponses(parsed.responsesByIssueId);
  } catch {
    return {};
  }
}

function loadCachedChatResponsesByReviewId(): ChatResponsesByReviewId {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const storagePrefix = `${CHAT_HISTORY_STORAGE_PREFIX}.`;
    const storageKeys = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index)
    ).filter((key): key is string => key?.startsWith(storagePrefix) ?? false);

    return Object.fromEntries(
      storageKeys.flatMap((storageKey) => {
        const reviewCaseId = storageKey.slice(storagePrefix.length);
        const cachedChatResponses = loadCachedChatResponses(reviewCaseId);

        return hasStoredChatResponses(cachedChatResponses)
          ? [[reviewCaseId, cachedChatResponses]]
          : [];
      })
    );
  } catch {
    return {};
  }
}

function persistCachedChatResponses(
  reviewCaseId: string,
  responsesByIssueId: ChatResponsesByIssueId
): void {
  if (typeof window === "undefined" || !hasStoredChatResponses(responsesByIssueId)) {
    return;
  }

  try {
    window.localStorage.setItem(
      chatHistoryStorageKey(reviewCaseId),
      JSON.stringify({
        expiresAt: Date.now() + CHAT_HISTORY_RETENTION_MS,
        responsesByIssueId
      })
    );
  } catch {
    // Local browser storage can be unavailable in restricted modes; chat still works in memory.
  }
}

function isUploadedCreativeImage(file: ReviewCase["files"][number]) {
  const contentType = file.contentType?.toLowerCase() ?? "";
  const hasImageExtension = /\.(png|jpe?g|webp|gif)$/i.test(file.name);

  return (
    file.fileType === "promotional_creative" &&
    file.storageProvider !== "sample" &&
    Boolean(file.storageKey) &&
    (contentType.startsWith("image/") || hasImageExtension)
  );
}

export function ReviewDetailWorkspace({ review }: { review: ReviewCase }): JSX.Element {
  const roleContext = useRoleContext();
  const activeRole = roleContext?.activeRole ?? "reviewer";
  const roleHeaders = useMemo(
    () => roleContext?.apiHeaders() ?? { "x-finproof-role": activeRole },
    [activeRole, roleContext]
  );
  const uploadedCreativeFile = useMemo(
    () => review.files.find(isUploadedCreativeImage),
    [review.files]
  );
  const jsonHeaders = useMemo(
    () =>
      roleContext?.apiHeaders({ "content-type": "application/json" }) ?? {
        ...roleHeaders,
        "content-type": "application/json"
      },
    [roleContext, roleHeaders]
  );
  const apiHeaders = useCallback(
    (extra?: Record<string, string>) =>
      roleContext?.apiHeaders(extra) ?? { ...roleHeaders, ...(extra ?? {}) },
    [roleContext, roleHeaders]
  );
  const reviewerCanMutate = canMutateReview(activeRole);
  const [reviewStatus, setReviewStatus] = useState<ReviewCase["status"]>(review.status);
  const [manualIssues, setManualIssues] = useState<ReviewIssue[]>([]);
  const allIssues = useMemo<ReviewIssue[]>(() => {
    if (manualIssues.length === 0) {
      return review.issues;
    }

    const existingIds = new Set(review.issues.map((issue) => issue.id));

    return [...review.issues, ...manualIssues.filter((issue) => !existingIds.has(issue.id))];
  }, [review.issues, manualIssues]);
  const [selectedIssueId, setSelectedIssueId] = useState(review.issues[0]?.id);
  const initialVersion = review.currentVersion ?? 1;
  const [versions, setVersions] = useState<ReviewVersion[]>([]);
  const [currentVersionNumber, setCurrentVersionNumber] = useState(initialVersion);
  const [selectedVersionNumber, setSelectedVersionNumber] = useState(initialVersion);
  const [revisionDiff, setRevisionDiff] = useState<RevisionDiff | null>(null);
  const [analysisErrorMessage, setAnalysisErrorMessage] = useState<string | null>(null);
  const [isRetryingAnalysis, setIsRetryingAnalysis] = useState(false);
  const [isManualIssueOpen, setIsManualIssueOpen] = useState(false);
  const [isSubmittingManualIssue, setIsSubmittingManualIssue] = useState(false);
  const [manualIssueError, setManualIssueError] = useState<string | null>(null);
  const [draft, setDraftState] = useState("");
  const latestDraftRef = useRef(draft);
  const [certificateDraft, setCertificateDraft] = useState<CertificateDraft>({
    body: "",
    certificateNumber: "",
    validFrom: "",
    validUntil: "",
    remarks: ""
  });
  const [uploadedCreativeObject, setUploadedCreativeObject] = useState<{
    fileId: string;
    url: string;
  } | null>(null);
  const [failedUploadedCreativeFileId, setFailedUploadedCreativeFileId] = useState<string | null>(
    null
  );
  const [draftVersion, setDraftVersion] = useState(0);
  const [question, setQuestion] = useState("");
  const [isChatWidgetOpen, setIsChatWidgetOpen] = useState(false);
  const [isProgressOpen, setIsProgressOpen] = useState(false);
  const [hasUnreadChatResponse, setHasUnreadChatResponse] = useState(false);
  const [chatResponsesByReviewId, setChatResponsesByReviewId] = useState<ChatResponsesByReviewId>(
    () => loadCachedChatResponsesByReviewId()
  );
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
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [chatProgress, setChatProgress] = useState<ChatProgressEvent | null>(null);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSavingDecision, setIsSavingDecision] = useState(false);
  const [isFinalizingReview, setIsFinalizingReview] = useState(false);
  const [finalizedNotice, setFinalizedNotice] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const chatResponsesByIssueId = chatResponsesByReviewId[review.id] ?? {};
  const selectedIssue: ReviewIssue | undefined =
    allIssues.find((issue) => issue.id === selectedIssueId) ?? allIssues[0];
  const visibleChatResponses = Object.entries(chatResponsesByIssueId).flatMap(
    ([issueId, responses]) => responses.map((response) => ({ issueId, response }))
  );
  const chatHasLongAnswer = visibleChatResponses.some(
    ({ response }) => response.content.length >= 900
  );
  const selectedPendingQuestion =
    selectedIssue && pendingQuestion?.issueId === selectedIssue.id ? pendingQuestion : null;
  const savedDecision = selectedIssue ? (savedDecisionsByIssueId[selectedIssue.id] ?? null) : null;
  const finalReviewAction = getFinalReviewAction(savedDecisionsByIssueId);
  const uploadedCreativeObjectUrl =
    uploadedCreativeObject && uploadedCreativeObject.fileId === uploadedCreativeFile?.id
      ? uploadedCreativeObject.url
      : null;
  const isUploadedCreativeLoading = Boolean(
    uploadedCreativeFile &&
    !uploadedCreativeObjectUrl &&
    failedUploadedCreativeFileId !== uploadedCreativeFile.id
  );
  const uploadedCreativeFailed = Boolean(
    uploadedCreativeFile &&
    !uploadedCreativeObjectUrl &&
    failedUploadedCreativeFileId === uploadedCreativeFile.id
  );

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawTab = searchParams?.get("tab") ?? null;
  const initialTab: IssueDetailTabKey =
    rawTab === "evidence" || rawTab === "opinion" ? rawTab : "checklist";
  const [activeTab, setActiveTabState] = useState<IssueDetailTabKey>(initialTab);

  useEffect(() => {
    const currentReviewChatResponses = chatResponsesByReviewId[review.id] ?? {};

    persistCachedChatResponses(review.id, currentReviewChatResponses);
  }, [chatResponsesByReviewId, review.id]);

  useEffect(() => {
    if (!uploadedCreativeFile) {
      return undefined;
    }

    const file = uploadedCreativeFile;
    let objectUrl: string | null = null;
    let cancelled = false;
    const contentUrl = `/api/v1/review-cases/${encodeURIComponent(
      review.id
    )}/files/${encodeURIComponent(file.id)}/content`;

    async function loadUploadedCreative() {
      try {
        const response = await fetch(contentUrl, { headers: roleHeaders });
        const blob = response.ok ? await response.blob() : undefined;

        if (cancelled) {
          return;
        }

        if (!blob) {
          setFailedUploadedCreativeFileId(file.id);
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setFailedUploadedCreativeFileId(null);
        setUploadedCreativeObject({ fileId: file.id, url: objectUrl });
      } catch {
        if (!cancelled) {
          setFailedUploadedCreativeFileId(file.id);
        }
      }
    }

    void loadUploadedCreative();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [review.id, roleHeaders, uploadedCreativeFile]);

  useEffect(() => {
    if (!finalizedNotice && !reportNotice && !draftNotice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setFinalizedNotice(null);
      setReportNotice(null);
      setDraftNotice(null);
    }, NOTICE_AUTO_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [finalizedNotice, reportNotice, draftNotice]);

  useEffect(() => {
    if (initialVersion <= 1) {
      return undefined;
    }

    let cancelled = false;

    async function loadVersions() {
      try {
        const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/versions`, {
          headers: roleHeaders
        });

        if (!apiResponse.ok || cancelled) {
          return;
        }

        const body = (await apiResponse.json()) as {
          currentVersion: number;
          versions: ReviewVersion[];
        };

        if (cancelled) {
          return;
        }

        setVersions(body.versions);
        setCurrentVersionNumber(body.currentVersion);
      } catch {
        // Version history is supplemental; the live workbench still renders without it.
      }
    }

    void loadVersions();

    return () => {
      cancelled = true;
    };
  }, [review.id, roleHeaders, initialVersion]);

  // 재업로드(v2+) 재검토 시 직전 버전 대비 변경분석을 지연 로드한다. 요청자 화면에는 노출하지 않는다.
  useEffect(() => {
    if (activeRole === "requester" || currentVersionNumber <= 1) {
      return undefined;
    }

    let cancelled = false;

    async function loadRevisionDiff() {
      try {
        const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/revision-diff`, {
          headers: roleHeaders
        });

        if (!apiResponse.ok || cancelled) {
          return;
        }

        const body = (await apiResponse.json()) as
          | { available: true; diff: RevisionDiff }
          | { available: false; reason: string };

        if (cancelled) {
          return;
        }

        setRevisionDiff(body.available ? body.diff : null);
      } catch {
        // 변경분석은 보조 정보이므로 실패해도 워크벤치는 단일 모드로 정상 동작한다.
      }
    }

    void loadRevisionDiff();

    return () => {
      cancelled = true;
    };
  }, [review.id, roleHeaders, activeRole, currentVersionNumber]);

  useEffect(() => {
    if (review.status !== "analysis_failed") {
      return undefined;
    }

    let cancelled = false;

    async function loadAnalysisFailure() {
      try {
        const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/analysis/status`, {
          headers: roleHeaders
        });

        if (!apiResponse.ok || cancelled) {
          return;
        }

        const body = (await apiResponse.json()) as { errorMessage?: string };

        if (cancelled || !body.errorMessage) {
          return;
        }

        setAnalysisErrorMessage(body.errorMessage);
      } catch {
        // The banner still renders with a generic message if the status probe fails.
      }
    }

    void loadAnalysisFailure();

    return () => {
      cancelled = true;
    };
  }, [review.id, review.status, roleHeaders]);

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

  function setDraft(nextDraft: string) {
    latestDraftRef.current = nextDraft;
    setDraftState(nextDraft);
  }

  function selectIssue(issueId: string) {
    const nextIssue = allIssues.find((issue) => issue.id === issueId);
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

    const reviewCaseId = review.id;
    const issueId = selectedIssue.id;
    const submittedQuestion = question.trim();
    const currentReviewChatResponses = chatResponsesByReviewId[reviewCaseId] ?? {};

    setInteractionError(null);
    setIsAskingQuestion(true);
    setPendingQuestion({ issueId, question: submittedQuestion });
    setChatProgress(null);
    setQuestion("");
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${reviewCaseId}/chat`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          issueId,
          question: submittedQuestion,
          history: (currentReviewChatResponses[issueId] ?? []).map((response) => ({
            question: response.question,
            answer: response.content
          }))
        })
      });

      if (!apiResponse.ok) {
        throw new Error("질문 요청을 처리하지 못했습니다.");
      }

      let finalResponse: ReviewChatResponse | null = null;

      if (apiResponse.body) {
        // 기본 경로: NDJSON 진행 스트림(단계/MCP 이벤트 + 마지막 done).
        const reader = apiResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim().length === 0) {
              continue;
            }

            const event = JSON.parse(line) as ChatProgressEvent;

            if (event.type === "done") {
              finalResponse = event.response;
            } else if (event.type !== "error") {
              setChatProgress(event);
            }
          }
        }
      } else {
        // 폴백: 스트림이 아닌 단일 JSON({ response }) 응답도 허용.
        const payload = (await apiResponse.json()) as { response?: ReviewChatResponse };
        finalResponse = payload.response ?? null;
      }

      if (!finalResponse) {
        throw new Error("질문 요청을 처리하지 못했습니다.");
      }

      const answered = finalResponse;

      setChatResponsesByReviewId((current) => {
        const currentReviewResponses = current[reviewCaseId] ?? {};

        return {
          ...current,
          [reviewCaseId]: {
            ...currentReviewResponses,
            [issueId]: [...(currentReviewResponses[issueId] ?? []), answered]
          }
        };
      });
      setHasUnreadChatResponse(true);
    } catch (error) {
      setQuestion(submittedQuestion);
      setInteractionError(
        error instanceof Error ? error.message : "질문 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsAskingQuestion(false);
      setPendingQuestion(null);
      setChatProgress(null);
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleAskQuestion();
  }

  async function generateDraft() {
    if (!reviewerCanMutate) {
      return;
    }

    const currentReviewChatResponses = chatResponsesByReviewId[review.id] ?? {};
    const draftChatResponses = Object.values(currentReviewChatResponses).flat();

    setInteractionError(null);
    setIsGeneratingDraft(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/draft`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ chatResponses: draftChatResponses })
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
    const issueIds = selectedIssue ? [selectedIssue.id] : allIssues.map((issue) => issue.id);

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

  async function finalizeReviewCase(finalAction: FinalDecisionAction) {
    if (!reviewerCanMutate || isFinalizingReview) {
      return;
    }

    let confirmed: boolean;

    if (finalAction === "reject" && draft.trim().length === 0) {
      confirmed = window.confirm(
        "수정 요청 의견을 작성하지 않았습니다. 의견 없이 반려하시겠습니까?"
      );
    } else if (finalAction === "approve" && certificateDraft.body.trim().length === 0) {
      confirmed = window.confirm(
        "심의필을 작성하지 않았습니다. 심의필 없이 승인하시겠습니까?"
      );
    } else {
      confirmed = window.confirm(
        `이 심의를 ${finalDecisionConfirmPhrases[finalAction]} 확정하시겠습니까? 확정 후 심의 이력에 반영됩니다.`
      );
    }

    if (!confirmed) {
      return;
    }

    setInteractionError(null);
    setFinalizedNotice(null);
    setIsFinalizingReview(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/finalize`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ finalAction })
      });

      if (!apiResponse.ok) {
        throw new Error("최종 확정 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as {
        reviewCase: Pick<ReviewCase, "status">;
      };

      setReviewStatus(body.reviewCase.status);
      setFinalizedNotice(`최종 상태가 ${statusLabels[body.reviewCase.status]}으로 저장되었습니다.`);

      const trimmedCertificateBody = certificateDraft.body.trim();
      const trimmedCertificateNumber = certificateDraft.certificateNumber.trim();

      if (finalAction === "approve" && trimmedCertificateBody.length > 0) {
        if (trimmedCertificateNumber.length === 0) {
          // 번호가 없으면 자동 발급은 보류하되, 작성한 내용은 임시 저장해 심의 이력에서 그대로 불러올 수 있게 한다.
          try {
            const draftResponse = await fetch(
              `/api/v1/review-cases/${review.id}/certificate`,
              {
                method: "PUT",
                headers: jsonHeaders,
                body: JSON.stringify({
                  body: trimmedCertificateBody,
                  certificateNumber: trimmedCertificateNumber,
                  validFrom: certificateDraft.validFrom,
                  validUntil: certificateDraft.validUntil,
                  remarks: certificateDraft.remarks
                })
              }
            );

            if (!draftResponse.ok) {
              throw new Error("certificate draft save failed");
            }

            setInteractionError(
              "심의필 번호가 없어 자동 발급되지 않았습니다. 작성한 내용은 저장되었으니 심의 이력에서 발급해 주세요."
            );
          } catch {
            setInteractionError(
              "심의필 번호가 없어 자동 발급되지 않았습니다. 심의 이력에서 발급해 주세요."
            );
          }
        } else {
          try {
            const certificateResponse = await fetch(
              `/api/v1/review-cases/${review.id}/certificate`,
              {
                method: "POST",
                headers: jsonHeaders,
                body: JSON.stringify({
                  body: trimmedCertificateBody,
                  certificateNumber: trimmedCertificateNumber,
                  validFrom: certificateDraft.validFrom,
                  validUntil: certificateDraft.validUntil,
                  remarks: certificateDraft.remarks
                })
              }
            );

            if (!certificateResponse.ok) {
              throw new Error("certificate issue failed");
            }
          } catch {
            setInteractionError(
              "승인은 완료되었으나 심의필 발급에 실패했습니다. 심의 이력에서 다시 시도해 주세요."
            );
          }
        }
      }

      router.push("/reviews?scope=history");
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "최종 확정 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsFinalizingReview(false);
    }
  }

  async function retryAnalysis() {
    if (!reviewerCanMutate || isRetryingAnalysis) {
      return;
    }

    setInteractionError(null);
    setIsRetryingAnalysis(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/analysis/start`, {
        method: "POST",
        headers: jsonHeaders
      });

      if (!apiResponse.ok) {
        throw new Error("AI 분석 재시도 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as { status?: ReviewCase["status"] };

      if (body.status) {
        setReviewStatus(body.status);
      }

      setAnalysisErrorMessage(null);
      router.refresh();
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "AI 분석 재시도 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsRetryingAnalysis(false);
    }
  }

  async function submitManualIssue(input: ManualIssueInput) {
    if (!reviewerCanMutate || isSubmittingManualIssue) {
      return;
    }

    setManualIssueError(null);
    setIsSubmittingManualIssue(true);
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${review.id}/issues`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          title: input.title,
          riskLevel: input.riskLevel,
          suggestedAction: input.suggestedAction,
          ...(input.targetText ? { targetText: input.targetText } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.suggestedCopy ? { suggestedCopy: input.suggestedCopy } : {})
        })
      });

      if (!apiResponse.ok) {
        throw new Error("이슈 추가 요청을 처리하지 못했습니다.");
      }

      const body = (await apiResponse.json()) as { issue: ReviewIssue };

      setManualIssues((current) => [...current, body.issue]);
      setSelectedIssueId(body.issue.id);
      setIsManualIssueOpen(false);
      setManualIssueError(null);
      router.refresh();
    } catch (error) {
      setManualIssueError(
        error instanceof Error ? error.message : "이슈 추가 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsSubmittingManualIssue(false);
    }
  }

  const chatPanel = (
    <div className="panel panel--compact chat-panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Issue Query</p>
          <h3>선택 이슈 기반 질의</h3>
        </div>
      </div>

      <div
        className="chat-thread"
        data-scroll-region="chat-history"
        aria-label="채팅 대화"
        aria-live="polite"
      >
        {!selectedIssue ? (
          <div className="chat-empty-prompt">
            <strong>선택 가능한 이슈가 없습니다.</strong>
            <span>
              {review.analysisNotice ??
                "선택 이슈가 생성된 후 근거 기반 질의를 사용할 수 있습니다."}
            </span>
          </div>
        ) : visibleChatResponses.length === 0 && !selectedPendingQuestion ? (
          <div className="chat-empty-prompt">
            <strong>선택된 이슈의 근거를 기준으로 답변합니다.</strong>
            <span>
              입력창의 회색 예시처럼 질문을 작성하면 근거 문서와 이슈 내용을 함께 참조합니다.
            </span>
          </div>
        ) : (
          visibleChatResponses.map(({ issueId, response }) => (
            <article
              key={`${issueId}-${response.id}`}
              className="chat-turn"
              data-answer-type={response.answerType}
            >
              <div className="chat-message chat-message--user">
                <div className="chat-message__bubble">{response.question}</div>
              </div>
              <div className="chat-message chat-message--assistant">
                <span className="chat-message__avatar" aria-hidden="true">
                  AI
                </span>
                <div className="chat-message__bubble">
                  <FormattedChatContent content={response.content} />
                  {response.requiredMaterials.length > 0 ? (
                    <div className="evidence-inline">
                      {response.requiredMaterials.map((material) => (
                        <span key={material}>{material}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          ))
        )}
        {selectedPendingQuestion ? (
          <article className="chat-turn chat-turn--pending">
            <div className="chat-message chat-message--user">
              <div className="chat-message__bubble">{selectedPendingQuestion.question}</div>
            </div>
            <div className="chat-message chat-message--assistant">
              <span className="chat-message__avatar" aria-hidden="true">
                AI
              </span>
              <div className="chat-message__bubble chat-message__bubble--loading">
                <span>{chatProgressLabel(chatProgress)}</span>
                {chatProgress?.type === "mcp" ? (
                  <span className="chat-message__progress-tool">
                    {chatProgress.tool} · {chatProgress.query}
                  </span>
                ) : null}
                <span className="typing-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </div>
          </article>
        ) : null}
      </div>

      <form className="chat-composer" aria-label="채팅 입력" onSubmit={submitQuestion}>
        <label className="sr-only" htmlFor="rag-question">
          RAG question
        </label>
        <input
          id="rag-question"
          value={question}
          aria-label="RAG question"
          placeholder="예: 최고금리 조건을 승인 가능하게 표시하려면?"
          disabled={!selectedIssue}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          className="icon-button"
          type="submit"
          aria-label="질문 보내기"
          disabled={!selectedIssue || isAskingQuestion || question.trim().length === 0}
        >
          {isAskingQuestion ? (
            <LoaderCircle className="action-spinner" size={17} aria-hidden="true" />
          ) : (
            <Send size={17} aria-hidden="true" />
          )}
        </button>
      </form>
    </div>
  );

  const draftPanel = (
    <div className="panel panel--compact draft-panel">
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
            {isSavingDraft ? (
              <LoaderCircle className="action-spinner" size={18} aria-hidden="true" />
            ) : (
              <Save size={18} aria-hidden="true" />
            )}
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="리포트 다운로드"
            title="리포트 다운로드"
            disabled={!reviewerCanMutate || isGeneratingReport}
            onClick={generateReportDownload}
          >
            {isGeneratingReport ? (
              <LoaderCircle className="action-spinner" size={18} aria-hidden="true" />
            ) : (
              <Download size={18} aria-hidden="true" />
            )}
          </button>
          <button
            className="button button--primary"
            type="button"
            aria-label="초안 생성"
            disabled={!reviewerCanMutate || isGeneratingDraft}
            onClick={generateDraft}
          >
            {isGeneratingDraft ? (
              <LoaderCircle className="action-spinner" size={18} aria-hidden="true" />
            ) : (
              <FilePenLine size={18} aria-hidden="true" />
            )}
            {isGeneratingDraft ? "생성 중" : "초안 생성"}
          </button>
        </div>
      </div>
      <textarea
        className="draft-editor"
        value={draft}
        aria-label="Opinion draft"
        data-scroll-region="draft-editor"
        disabled={!reviewerCanMutate}
        placeholder={reviewerCanMutate ? "초안 생성 버튼을 눌러 AI 초안을 생성하세요." : ""}
        onChange={(event) => {
          setDraft(event.target.value);
          setDraftNotice(null);
        }}
      />
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

  const certificatePanel = (
    <CertificateEditor
      caseId={review.id}
      title={review.title}
      issuerName={roleContext?.currentUser?.name ?? review.reviewer}
      productType={review.productType}
      reviewerName={review.reviewer}
      reviewStatus={reviewStatus}
      canMutate={reviewerCanMutate}
      apiHeaders={apiHeaders}
      draft={certificateDraft}
      onDraftChange={setCertificateDraft}
    />
  );

  const isAnalysisFailed = reviewStatus === "analysis_failed";
  const showVersionSelector = currentVersionNumber > 1;
  const selectedPastVersion =
    selectedVersionNumber < currentVersionNumber
      ? versions.find((version) => version.versionNumber === selectedVersionNumber)
      : undefined;
  const isViewingPastVersion = Boolean(selectedPastVersion);

  const versionSelectorNode = showVersionSelector ? (
    <div className={styles.versionSelector} role="group" aria-label="심의 버전 선택">
      <span className={styles.versionLabel}>심의 버전</span>
      <div className={styles.versionOptions}>
        {Array.from({ length: currentVersionNumber }, (_, index) => index + 1).map(
          (versionNumber) => (
            <button
              key={versionNumber}
              className="chip"
              type="button"
              data-active={versionNumber === selectedVersionNumber}
              aria-pressed={versionNumber === selectedVersionNumber}
              onClick={() => setSelectedVersionNumber(versionNumber)}
            >
              {versionNumber === currentVersionNumber ? `v${versionNumber} (현재)` : `v${versionNumber}`}
            </button>
          )
        )}
      </div>
      {isViewingPastVersion ? (
        <span className={styles.versionViewingNote}>과거 회차 — 읽기 전용 스냅샷</span>
      ) : null}
    </div>
  ) : null;

  const failureBannerNode = isAnalysisFailed ? (
    <div className={styles.failureBanner} role="alert">
      <AlertTriangle className={styles.failureBannerIcon} size={22} aria-hidden="true" />
      <div className={styles.failureBannerBody}>
        <span className={styles.failureBannerTitle}>AI 분석 실패 — 직접검토 모드</span>
        <p className={styles.failureBannerReason}>
          {analysisErrorMessage ??
            "AI 분석이 완료되지 못했습니다. 직접검토로 이슈를 추가하거나 분석을 다시 시도할 수 있습니다."}
        </p>
      </div>
      {reviewerCanMutate ? (
        <div className={styles.failureBannerActions}>
          <button
            className="button button--primary"
            type="button"
            disabled={isRetryingAnalysis}
            onClick={retryAnalysis}
          >
            {isRetryingAnalysis ? (
              <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
            ) : (
              <RotateCw size={16} aria-hidden="true" />
            )}
            {isRetryingAnalysis ? "재시도 중" : "AI 분석 재시도"}
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="detail">
      {versionSelectorNode}

      <WorkbenchHeader
        id={review.id}
        title={review.title}
        reviewStatus={reviewStatus}
        riskLevel={review.highestRiskLevel}
        productLabel={productLabels[review.productType]}
        requestDepartment={review.requestDepartment}
        requester={review.requester}
        reviewer={review.reviewer}
        deadline={review.plannedPublishDate}
        canMutate={reviewerCanMutate}
        isFinalizingReview={isFinalizingReview}
        onFinalizeReviewCase={finalizeReviewCase}
      />

      {isViewingPastVersion && selectedPastVersion ? (
        <VersionHistoryPanel version={selectedPastVersion} />
      ) : (
        <>
          {failureBannerNode}

          <section className="detail__grid">
            <IssueList
              issues={allIssues}
              selectedIssueId={selectedIssue?.id}
              onSelectIssue={selectIssue}
              analysisNotice={review.analysisNotice}
              canAddManualIssue={reviewerCanMutate}
              onAddManualIssue={() => {
                setManualIssueError(null);
                setIsManualIssueOpen(true);
              }}
            />

            <CreativeViewer
              copy={review.promotionalCopy}
              disclosure={review.disclosure}
              creativeImage={
                uploadedCreativeFile && uploadedCreativeObjectUrl
                  ? { src: uploadedCreativeObjectUrl, alt: uploadedCreativeFile.name }
                  : undefined
              }
              isCreativeImageLoading={Boolean(uploadedCreativeFile) && isUploadedCreativeLoading}
              creativeImageError={uploadedCreativeFailed}
              issues={allIssues}
              selectedIssueId={selectedIssue?.id}
              onSelectIssue={selectIssue}
              revisionDiff={
                activeRole !== "requester" && currentVersionNumber > 1 ? revisionDiff : null
              }
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
                isSavingDecision={isSavingDecision}
                onChangeRiskLevel={setReviewerRiskLevel}
                onChangeReviewerComment={setReviewerComment}
                onSaveReviewerDecision={saveReviewerDecision}
              />
            ) : null}
          </section>

          <WorkbenchDrawer
            defaultCollapsed={activeRole === "requester"}
            draftNode={draftPanel}
            filesNode={filesPanel}
            certificateNode={reviewerCanMutate ? certificatePanel : undefined}
          />

          {isManualIssueOpen ? (
            <ManualIssueForm
              onSubmit={submitManualIssue}
              onClose={() => {
                setIsManualIssueOpen(false);
                setManualIssueError(null);
              }}
              isSubmitting={isSubmittingManualIssue}
              error={manualIssueError}
            />
          ) : null}

          <div className="chat-widget" data-open={isChatWidgetOpen ? "true" : "false"}>
        {isChatWidgetOpen ? (
          <section
            className="chat-widget__panel"
            data-size={chatHasLongAnswer ? "expanded" : "default"}
            role="dialog"
            aria-label="근거 채팅"
            aria-modal="false"
          >
            <header className="chat-widget__header">
              <span className="chat-widget__brand-mark" aria-hidden="true">
                <MessageCircle size={32} />
              </span>
              <div>
                <p className="chat-widget__brand-name">FinProof Agent</p>
                <h2>근거 채팅</h2>
              </div>
            </header>
            <div className="chat-widget__intro">
              <span className="chat-widget__mini-mark" aria-hidden="true">
                <MessageCircle size={20} />
              </span>
              <div>
                <strong>안녕하세요, FinProof Agent입니다.</strong>
                <p>선택한 이슈와 승인 지식문서를 기준으로 답변합니다.</p>
              </div>
            </div>
            <div className="chat-widget__body">{chatPanel}</div>
          </section>
        ) : null}
        <button
          className="progress-launcher"
          type="button"
          aria-label={isProgressOpen ? "분석 진행상황 닫기" : "분석 진행상황 열기"}
          title={isProgressOpen ? "분석 진행상황 닫기" : "분석 진행상황 열기"}
          onClick={() => setIsProgressOpen((current) => !current)}
        >
          분석 진행상황
        </button>
        {isProgressOpen ? (
          <AnalysisProgressPopup
            key={review.id}
            reviewCaseId={review.id}
            onClose={() => setIsProgressOpen(false)}
          />
        ) : null}
        <button
          className="chat-launcher"
          data-open={isChatWidgetOpen ? "true" : "false"}
          type="button"
          aria-label={isChatWidgetOpen ? "근거 채팅 닫기" : "근거 채팅 열기"}
          title={isChatWidgetOpen ? "근거 채팅 닫기" : "근거 채팅 열기"}
          onClick={() => {
            setIsChatWidgetOpen((current) => {
              if (!current) setHasUnreadChatResponse(false);
              return !current;
            });
          }}
        >
          {isChatWidgetOpen ? (
            <X size={34} aria-hidden="true" />
          ) : (
            <>
              <MessageCircle size={34} aria-hidden="true" />
              {hasUnreadChatResponse && (
                <span className="chat-launcher__badge" aria-hidden="true" />
              )}
            </>
          )}
        </button>
          </div>
        </>
      )}

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
