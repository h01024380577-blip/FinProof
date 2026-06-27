"use client";

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { productLabels } from "@/domain/reviews";
import type { ReviewCase, ReviewStatus, ReviewSummary, RoleId } from "@/domain/types";
import { CertificateDocument } from "./CertificateDocument";
import { RevisionUploadPanel } from "./RevisionUploadPanel";
import { SamplePackageSelector } from "./SamplePackageSelector";
import { useRole } from "./RoleContext";
import styles from "./RequesterRequestHistory.module.css";

type ApiHeaders = (extra?: Record<string, string>) => Record<string, string>;

type RequesterUser = {
  name: string;
  role: RoleId;
  userId: string;
};

type RequesterRoleContext = ReturnType<typeof useRole> & {
  isAuthenticated?: boolean;
  currentUser?: RequesterUser | null;
};

type ReviewCasesResponse = {
  items?: ReviewSummary[];
  reviewCases?: ReviewSummary[];
};

type ReviewCaseResponse = {
  reviewCase?: ReviewCase;
};

function requesterTableStatus(status: ReviewStatus): {
  label: "검토중" | "승인" | "반려" | "수정 요청";
  statusTone: "in-progress" | "approved" | "rejected" | "change-requested";
} {
  if (status === "approved") return { label: "승인", statusTone: "approved" };
  if (status === "rejected") return { label: "반려", statusTone: "rejected" };
  if (status === "change_requested")
    return { label: "수정 요청", statusTone: "change-requested" };
  return { label: "검토중", statusTone: "in-progress" };
}

function useRequesterAccess(): {
  roleContext: RequesterRoleContext;
  requesterName: string;
  canUseRequesterCenter: boolean;
} {
  const roleContext = useRole() as RequesterRoleContext;
  const requesterName = roleContext.currentUser?.name.trim() ?? "";
  const canUseRequesterCenter =
    roleContext.isAuthenticated === true &&
    roleContext.activeRole === "requester" &&
    roleContext.currentUser?.role === "requester" &&
    requesterName.length > 0;

  return { roleContext, requesterName, canUseRequesterCenter };
}

function RequesterLoginRequired(): JSX.Element {
  return (
    <section className="queue-panel" aria-label="요청자 로그인 필요">
      <p className="queue-empty-state">요청자 계정으로 로그인해 주세요.</p>
    </section>
  );
}

export function RequesterRequestCenter(): JSX.Element {
  const { canUseRequesterCenter } = useRequesterAccess();

  if (!canUseRequesterCenter) return <RequesterLoginRequired />;

  return (
    <div className="requester-request-center">
      <SamplePackageSelector />
    </div>
  );
}

export function RequesterRequestHistory(): JSX.Element {
  const { roleContext, canUseRequesterCenter } = useRequesterAccess();

  if (!canUseRequesterCenter) return <RequesterLoginRequired />;

  return (
    <div className="requester-request-center">
      <RequesterHistoryPanel apiHeaders={roleContext.apiHeaders} />
    </div>
  );
}

/* ----------------------------- Status grouping ----------------------------- */

type FilterKey = "all" | "in_progress" | "action" | "approved";
type StatusCategory = "in_progress" | "action" | "approved";

function statusCategory(status: ReviewStatus): StatusCategory {
  if (status === "approved") return "approved";
  if (status === "change_requested" || status === "rejected") return "action";
  return "in_progress";
}

function matchesFilter(status: ReviewStatus, key: FilterKey): boolean {
  if (key === "all") return true;
  return statusCategory(status) === key;
}

const FILTER_DEFS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "in_progress", label: "진행중" },
  { key: "action", label: "조치 필요" },
  { key: "approved", label: "승인" }
];

/* ------------------------------ Master–detail ------------------------------ */

function RequesterHistoryPanel({ apiHeaders }: { apiHeaders: ApiHeaders }): JSX.Element {
  const [requests, setRequests] = useState<ReviewSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, ReviewCase | null>>({});

  useEffect(() => {
    let mounted = true;

    async function loadRequesterHistory(): Promise<void> {
      if (mounted) {
        setIsLoading(true);
        setLoadError(null);
      }

      try {
        const response = await fetch("/api/v1/review-cases", {
          headers: apiHeaders()
        });

        if (!response.ok) {
          throw new Error("요청 기록을 불러오지 못했습니다.");
        }

        const body = (await response.json()) as ReviewCasesResponse;
        const loaded = body.items ?? body.reviewCases ?? [];

        if (!mounted) return;

        setRequests(loaded);
        setSelectedId((previous) => {
          if (previous && loaded.some((review) => review.id === previous)) {
            return previous;
          }
          const actionNeeded = loaded.find(
            (review) =>
              review.status === "change_requested" || review.status === "rejected"
          );
          return actionNeeded?.id ?? loaded[0]?.id ?? null;
        });
      } catch (error) {
        if (mounted) {
          setLoadError(
            error instanceof Error ? error.message : "요청 기록을 불러오지 못했습니다."
          );
          setRequests([]);
          setSelectedId(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadRequesterHistory();

    return () => {
      mounted = false;
    };
  }, [apiHeaders, refreshToken]);

  const handleRefresh = useCallback((): void => {
    setRefreshToken((token) => token + 1);
  }, []);

  const selectedRequest = useMemo(
    () => requests.find((review) => review.id === selectedId) ?? null,
    [requests, selectedId]
  );

  const selectedNeedsOpinion =
    selectedRequest?.status === "rejected" || selectedRequest?.status === "change_requested";

  // Lazily fetch the reviewer opinion only when an action-needed request is selected.
  // `detailCache` is a dependency, but the guard below makes repeat runs no-ops
  // (it never refetches an id that is already cached).
  useEffect(() => {
    if (!selectedId || !selectedNeedsOpinion) return;
    if (detailCache[selectedId] !== undefined) return;

    let active = true;

    async function loadDetail(id: string): Promise<void> {
      try {
        const response = await fetch(`/api/v1/review-cases/${encodeURIComponent(id)}`, {
          headers: apiHeaders()
        });

        if (!active) return;

        if (!response.ok) {
          setDetailCache((cache) => ({ ...cache, [id]: null }));
          return;
        }

        const body = (await response.json()) as ReviewCaseResponse;

        if (active) {
          setDetailCache((cache) => ({ ...cache, [id]: body.reviewCase ?? null }));
        }
      } catch {
        if (active) {
          setDetailCache((cache) => ({ ...cache, [id]: null }));
        }
      }
    }

    void loadDetail(selectedId);

    return () => {
      active = false;
    };
  }, [selectedId, selectedNeedsOpinion, apiHeaders, detailCache]);

  const counts = useMemo(() => {
    const tally: Record<FilterKey, number> = {
      all: requests.length,
      in_progress: 0,
      action: 0,
      approved: 0
    };
    for (const review of requests) {
      tally[statusCategory(review.status)] += 1;
    }
    return tally;
  }, [requests]);

  const visibleRequests = useMemo(
    () => requests.filter((review) => matchesFilter(review.status, activeFilter)),
    [requests, activeFilter]
  );

  function handleFilterChange(next: FilterKey): void {
    setActiveFilter(next);
    setSelectedId((previous) => {
      const visible = requests.filter((review) => matchesFilter(review.status, next));
      if (previous && visible.some((review) => review.id === previous)) {
        return previous;
      }
      return visible[0]?.id ?? null;
    });
  }

  if (isLoading) {
    return (
      <section className={styles.shell} aria-label="요청 기록">
        <div className="queue-empty-state">
          <Loader2 className="action-spinner" size={18} aria-hidden="true" />
          요청 기록을 불러오는 중입니다.
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className={styles.shell} aria-label="요청 기록">
        <div className="queue-empty-state">
          <p className="interaction-error" role="alert">
            {loadError}
          </p>
        </div>
      </section>
    );
  }

  if (requests.length === 0) {
    return (
      <section className={styles.shell} aria-label="요청 기록">
        <p className="queue-empty-state">아직 요청 기록이 없습니다.</p>
      </section>
    );
  }

  const selectedDetail = selectedId ? detailCache[selectedId] : undefined;
  const opinionLoading = Boolean(selectedNeedsOpinion) && selectedDetail === undefined;
  const opinionText = selectedDetail?.currentDraft?.trim() ?? "";

  return (
    <section className={styles.shell} aria-label="요청 기록">
      <div className={styles.layout}>
        <div className={styles.master}>
          <div className={styles.filters} role="group" aria-label="상태 필터">
            {FILTER_DEFS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={styles.chip}
                data-active={activeFilter === filter.key}
                aria-pressed={activeFilter === filter.key}
                onClick={() => handleFilterChange(filter.key)}
              >
                {filter.label}
                <span className={styles.chipCount}>{counts[filter.key]}</span>
              </button>
            ))}
          </div>

          {visibleRequests.length === 0 ? (
            <p className={styles.listEmpty}>해당 상태의 요청이 없습니다.</p>
          ) : (
            <div className={styles.list} aria-label="요청 목록">
              {visibleRequests.map((review) => {
                const { label, statusTone } = requesterTableStatus(review.status);
                const selected = review.id === selectedId;
                return (
                  <button
                    key={review.id}
                    type="button"
                    className={styles.item}
                    aria-current={selected ? "true" : undefined}
                    aria-label={`${review.title}, ${label}`}
                    onClick={() => setSelectedId(review.id)}
                  >
                    <span className={styles.itemTitle}>{review.title}</span>
                    <span
                      className={`request-history-status ${styles.itemStatus}`}
                      data-status={statusTone}
                    >
                      {label}
                    </span>
                    <span className={styles.itemId}>
                      {review.id}
                      {(review.currentVersion ?? 1) > 1 ? (
                        <span className="requeue-badge">재업로드 v{review.currentVersion}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.detail}>
          {selectedRequest ? (
            <RequesterRequestDetail
              review={selectedRequest}
              needsOpinion={Boolean(selectedNeedsOpinion)}
              opinionLoading={opinionLoading}
              opinionText={opinionText}
              apiHeaders={apiHeaders}
              onRefresh={handleRefresh}
            />
          ) : (
            <p className={styles.emptyDetail}>왼쪽 목록에서 요청을 선택해 확인해 주세요.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- Detail panel ------------------------------ */

function MetaItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={styles.metaItem}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  );
}

function RequesterRequestDetail({
  review,
  needsOpinion,
  opinionLoading,
  opinionText,
  apiHeaders,
  onRefresh
}: {
  review: ReviewSummary;
  needsOpinion: boolean;
  opinionLoading: boolean;
  opinionText: string;
  apiHeaders: ApiHeaders;
  onRefresh: () => void;
}): JSX.Element {
  const { label, statusTone } = requesterTableStatus(review.status);
  const stage = deriveStage(review.status);
  const opinionHeading = review.status === "rejected" ? "반려 사유" : "수정 요청 의견";

  return (
    <>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <h3 className={styles.detailTitle}>{review.title}</h3>
          <span className="request-history-status" data-status={statusTone}>
            {label}
          </span>
          {(review.currentVersion ?? 1) > 1 ? (
            <span className="requeue-badge" title="수정본을 재업로드한 재심의 요청입니다">
              재업로드 v{review.currentVersion}
            </span>
          ) : null}
        </div>
        <p className={styles.detailId}>{review.id}</p>
        <div className={styles.metaGrid}>
          <MetaItem label="제휴사" value={review.affiliate} />
          <MetaItem label="상품유형" value={productLabels[review.productType]} />
          <MetaItem label="예정 게시일" value={review.plannedPublishDate} />
          <MetaItem label="담당자" value={review.reviewer || "미배정"} />
        </div>
      </header>

      <section className={styles.stepperSection} aria-label="진행 상황">
        <ProgressStepper stage={stage} />
        {stage.note ? <p className={styles.stageNote}>{stage.note}</p> : null}
      </section>

      {needsOpinion ? (
        <section className={styles.section} aria-label={opinionHeading}>
          <h4 className={styles.sectionHeading}>{opinionHeading}</h4>
          <div className={styles.opinionCard}>
            {opinionLoading ? (
              <p className={styles.subtleState} role="status">
                <Loader2 className="action-spinner" size={16} aria-hidden="true" />
                심의자 의견을 불러오는 중입니다.
              </p>
            ) : opinionText ? (
              <DraftNote text={opinionText} />
            ) : (
              <p className={styles.subtleState}>등록된 의견이 없습니다.</p>
            )}
          </div>
        </section>
      ) : null}

      {needsOpinion ? (
        <section className={styles.section} aria-label="수정본 재업로드">
          <RevisionUploadPanel caseId={review.id} apiHeaders={apiHeaders} onSuccess={onRefresh} />
        </section>
      ) : review.status === "approved" ? (
        <section className={styles.section} aria-label="심의필">
          <CertificateDocument caseId={review.id} apiHeaders={apiHeaders} />
        </section>
      ) : (
        <p className={styles.progressNote}>
          심의가 진행 중입니다. 결과가 나오면 이 화면에서 바로 확인할 수 있어요.
        </p>
      )}
    </>
  );
}

/* ------------------------------ Progress stepper ---------------------------- */

type ResultOutcome = "approved" | "rejected" | "change";

type StageInfo = {
  currentIndex: number;
  isFinal: boolean;
  outcome: ResultOutcome | null;
  stageLabel: string;
  note: string | null;
};

const STEP_LABELS = ["제출", "심의", "결과"] as const;

function deriveStage(status: ReviewStatus): StageInfo {
  switch (status) {
    case "draft":
      return {
        currentIndex: 0,
        isFinal: false,
        outcome: null,
        stageLabel: "제출 준비",
        note: null
      };
    case "submitted":
    case "parsing":
    case "analysis_waiting":
    case "analysis_queued":
    case "analysis_in_progress":
      return {
        currentIndex: 1,
        isFinal: false,
        outcome: null,
        stageLabel: "심의 대기",
        note: "제출이 완료되어 심의를 준비하고 있어요."
      };
    // analysis_failed is presented neutrally to the requester — no alarming wording.
    case "analysis_failed":
    case "analysis_complete":
    case "under_review":
      return {
        currentIndex: 1,
        isFinal: false,
        outcome: null,
        stageLabel: "심의 진행 중",
        note: "심의자가 검토하고 있어요."
      };
    case "approved":
      return {
        currentIndex: 2,
        isFinal: true,
        outcome: "approved",
        stageLabel: "승인 완료",
        note: "심의가 완료되어 심의필을 발급했어요."
      };
    case "rejected":
      return {
        currentIndex: 2,
        isFinal: true,
        outcome: "rejected",
        stageLabel: "반려",
        note: "심의 결과 반려되었어요. 아래 의견을 확인해 주세요."
      };
    case "change_requested":
      return {
        currentIndex: 2,
        isFinal: true,
        outcome: "change",
        stageLabel: "수정 요청",
        note: "수정 요청 의견을 확인하고 수정본을 올려 주세요."
      };
    default:
      return {
        currentIndex: 1,
        isFinal: false,
        outcome: null,
        stageLabel: "심의 진행 중",
        note: null
      };
  }
}

function stepStateFor(index: number, stage: StageInfo): "complete" | "active" | "upcoming" {
  if (stage.isFinal) return "complete";
  if (index < stage.currentIndex) return "complete";
  if (index === stage.currentIndex) return "active";
  return "upcoming";
}

function stepNodeContent(
  index: number,
  state: "complete" | "active" | "upcoming",
  outcome: ResultOutcome | null
): JSX.Element {
  if (outcome === "approved") return <Check size={17} aria-hidden="true" />;
  if (outcome === "rejected") return <X size={17} aria-hidden="true" />;
  if (outcome === "change") return <AlertTriangle size={16} aria-hidden="true" />;
  if (state === "complete") return <Check size={17} aria-hidden="true" />;
  // 활성 단계는 무한 회전 스피너 대신 정적 단계 번호로 표시(요청기록 탭에서 스피너가 계속 돌지 않도록).
  return <span>{index + 1}</span>;
}

function ProgressStepper({ stage }: { stage: StageInfo }): JSX.Element {
  const lastIndex = STEP_LABELS.length - 1;

  return (
    <ol className={styles.stepper} aria-label={`진행 단계: ${stage.stageLabel}`}>
      {STEP_LABELS.map((label, index) => {
        const state = stepStateFor(index, stage);
        const outcome = index === lastIndex && stage.isFinal ? stage.outcome : null;
        return (
          <li
            key={label}
            className={styles.step}
            data-state={state}
            data-outcome={outcome ?? undefined}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className={styles.stepNode}>{stepNodeContent(index, state, outcome)}</span>
            <span className={styles.stepLabel}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------- Reviewer opinion (draft) rendering ------------------ */

type DraftLine =
  | { kind: "section"; text: string }
  | { kind: "issue"; num: string; text: string }
  | { kind: "bullet"; label: string; value: string }
  | { kind: "meta"; label: string; value: string }
  | { kind: "plain"; text: string }
  | { kind: "spacer" };

function parseDraftLine(raw: string): DraftLine {
  const line = raw.trim();
  if (!line) return { kind: "spacer" };

  if (/^(주요\s|종합|수정 요청 의견)/.test(line)) return { kind: "section", text: line };

  const issueMatch = /^(\d+)\.\s+(.+)/.exec(line);
  if (issueMatch) return { kind: "issue", num: issueMatch[1], text: issueMatch[2] };

  if (line.startsWith("- ")) {
    const rest = line.slice(2);
    const ci = rest.indexOf(": ");
    if (ci > 0) return { kind: "bullet", label: rest.slice(0, ci), value: rest.slice(ci + 2) };
    return { kind: "plain", text: rest };
  }

  const ci = line.indexOf(": ");
  if (ci > 0 && ci < 14)
    return { kind: "meta", label: line.slice(0, ci), value: line.slice(ci + 2) };

  return { kind: "plain", text: line };
}

function renderDraftLine(line: DraftLine, key: number): JSX.Element | null {
  if (line.kind === "spacer") return <div key={key} className="draft-note__gap" />;
  if (line.kind === "section")
    return (
      <p key={key} className="draft-note__section">
        {line.text}
      </p>
    );
  if (line.kind === "issue")
    return (
      <p key={key} className="draft-note__issue-heading">
        <span className="draft-note__issue-num">{line.num}</span>
        {line.text}
      </p>
    );
  if (line.kind === "bullet" || line.kind === "meta")
    return (
      <p key={key} className={`draft-note__kv draft-note__kv--${line.kind}`}>
        <span className="draft-note__kv-label">{line.label}</span>
        <span className="draft-note__kv-value">{line.value}</span>
      </p>
    );
  return (
    <p key={key} className="draft-note__plain">
      {line.text}
    </p>
  );
}

function DraftNote({ text }: { text: string }): JSX.Element {
  const parsed = text.split("\n").map(parseDraftLine);

  return (
    <div className="draft-note">
      {parsed
        .filter((l) => !(l.kind === "section" && l.text.startsWith("수정 요청 의견")))
        .map((line, i) => renderDraftLine(line, i))}
    </div>
  );
}
