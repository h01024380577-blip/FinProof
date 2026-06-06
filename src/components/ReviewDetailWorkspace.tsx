"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Download, FilePenLine, LoaderCircle, MessageCircle, Save, Send, X } from "lucide-react";
import type { ReviewChatResponse } from "@/domain/chat";
import type { ReviewReport } from "@/domain/reports";
import { productLabels, statusLabels } from "@/domain/reviews";
import type { ReviewCase, ReviewIssue, RiskLevel, RoleId } from "@/domain/types";
import { useRoleContext } from "./RoleContext";
import { WorkbenchHeader } from "./workbench/WorkbenchHeader";
import type { FinalDecisionAction } from "./workbench/WorkbenchHeader";
import { IssueList } from "./workbench/IssueList";
import { CreativeViewer } from "./workbench/CreativeViewer";
import { IssueDetailTabs, type IssueDetailTabKey } from "./workbench/IssueDetailTabs";
import { WorkbenchDrawer } from "./workbench/WorkbenchDrawer";

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
  const reviewerCanMutate = canMutateReview(activeRole);
  const [reviewStatus, setReviewStatus] = useState<ReviewCase["status"]>(review.status);
  const [selectedIssueId, setSelectedIssueId] = useState(review.issues[0]?.id);
  const [draft, setDraftState] = useState("");
  const latestDraftRef = useRef(draft);
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
    review.issues.find((issue) => issue.id === selectedIssueId) ?? review.issues[0];
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

    const reviewCaseId = review.id;
    const issueId = selectedIssue.id;
    const submittedQuestion = question.trim();
    const currentReviewChatResponses = chatResponsesByReviewId[reviewCaseId] ?? {};

    setInteractionError(null);
    setIsAskingQuestion(true);
    setPendingQuestion({ issueId, question: submittedQuestion });
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

      const body = (await apiResponse.json()) as { response: ReviewChatResponse };

      setChatResponsesByReviewId((current) => {
        const currentReviewResponses = current[reviewCaseId] ?? {};

        return {
          ...current,
          [reviewCaseId]: {
            ...currentReviewResponses,
            [issueId]: [...(currentReviewResponses[issueId] ?? []), body.response]
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

  async function finalizeReviewCase(finalAction: FinalDecisionAction) {
    if (!reviewerCanMutate || isFinalizingReview) {
      return;
    }

    const confirmed = window.confirm(
      `이 심의를 ${finalDecisionConfirmPhrases[finalAction]} 확정하시겠습니까? 확정 후 심의 이력에 반영됩니다.`
    );

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
      router.push("/reviews?scope=history");
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : "최종 확정 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsFinalizingReview(false);
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
                <span>답변 생성 중</span>
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

  return (
    <div className="detail">
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
          creativeImage={
            uploadedCreativeFile && uploadedCreativeObjectUrl
              ? { src: uploadedCreativeObjectUrl, alt: uploadedCreativeFile.name }
              : undefined
          }
          isCreativeImageLoading={Boolean(uploadedCreativeFile) && isUploadedCreativeLoading}
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
      />

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
