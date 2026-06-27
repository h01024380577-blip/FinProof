"use client";

import { useCallback, useEffect, useState, type JSX } from "react";
import { Loader2 } from "lucide-react";
import { productLabels } from "@/domain/reviews";
import type { ReviewCase, ReviewCertificate, ReviewSummary, RoleId } from "@/domain/types";
import { RevisionUploadPanel } from "./RevisionUploadPanel";
import { SamplePackageSelector } from "./SamplePackageSelector";
import { useRole } from "./RoleContext";
import styles from "./RevisionUploadPanel.module.css";

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

type RequestHistoryItem = ReviewSummary &
  Partial<Pick<ReviewCase, "currentDraft" | "currentDraftVersion">>;

function requesterTableStatus(status: ReviewCase["status"]): {
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

function RequesterHistoryPanel({ apiHeaders }: { apiHeaders: ApiHeaders }): JSX.Element {
  const [requests, setRequests] = useState<RequestHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

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
        const ownReviews = body.items ?? body.reviewCases ?? [];
        const detailedReviews = await Promise.all(
          ownReviews.map(async (review) => {
            const needsOpinion =
              review.status === "rejected" || review.status === "change_requested";
            if (!needsOpinion) {
              return review;
            }

            try {
              const detailResponse = await fetch(
                `/api/v1/review-cases/${encodeURIComponent(review.id)}`,
                {
                  headers: apiHeaders()
                }
              );

              if (!detailResponse.ok) {
                return review;
              }

              const detailBody = (await detailResponse.json()) as ReviewCaseResponse;

              return {
                ...review,
                ...detailBody.reviewCase
              };
            } catch {
              return review;
            }
          })
        );

        if (mounted) {
          setRequests(detailedReviews);
        }
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : "요청 기록을 불러오지 못했습니다.");
          setRequests([]);
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

  return (
    <section className="queue-panel" aria-label="요청 기록">
      {isLoading ? (
        <div className="queue-empty-state">
          <Loader2 className="action-spinner" size={18} aria-hidden="true" />
          요청 기록을 불러오는 중입니다.
        </div>
      ) : null}

      {loadError ? (
        <p className="interaction-error" role="alert">
          {loadError}
        </p>
      ) : null}

      {!isLoading && !loadError && requests.length === 0 ? (
        <p className="queue-empty-state">아직 요청 기록이 없습니다.</p>
      ) : null}

      {!isLoading && !loadError && requests.length > 0 ? (
        <div className="review-table review-table--history" role="grid" aria-label="요청 기록 목록">
          <div className="review-table__row review-table__row--head" role="row">
            <span role="columnheader">요청번호</span>
            <span role="columnheader">제목</span>
            <span role="columnheader">제휴사</span>
            <span role="columnheader">상품유형</span>
            <span role="columnheader">예정 게시일</span>
            <span role="columnheader">상태</span>
            <span role="columnheader">담당자</span>
            <span role="columnheader">작업</span>
          </div>
          {requests.map((review) => (
            <RequesterHistoryRow
              key={review.id}
              review={review}
              apiHeaders={apiHeaders}
              onRefresh={handleRefresh}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

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

type HistoryPanel = "none" | "opinion" | "revision" | "certificate";

function RequesterHistoryRow({
  review,
  apiHeaders,
  onRefresh
}: {
  review: RequestHistoryItem;
  apiHeaders: ApiHeaders;
  onRefresh: () => void;
}): JSX.Element {
  const { label, statusTone } = requesterTableStatus(review.status);
  const isRevisable = review.status === "change_requested" || review.status === "rejected";
  const isApproved = review.status === "approved";
  const opinionLabel = review.status === "rejected" ? "반려사유" : "수정요청 의견";
  const hasOpinion = isRevisable && Boolean(review.currentDraft?.trim());
  const [openPanel, setOpenPanel] = useState<HistoryPanel>("none");

  function togglePanel(panel: HistoryPanel): void {
    setOpenPanel((current) => (current === panel ? "none" : panel));
  }

  const hasActions = hasOpinion || isRevisable || isApproved;

  return (
    <>
      <div className="review-table__row" role="row" aria-label={review.title}>
        <span className="queue-id" role="cell">
          {review.id}
        </span>
        <strong role="cell">{review.title}</strong>
        <span role="cell">{review.affiliate}</span>
        <span role="cell">{productLabels[review.productType]}</span>
        <span role="cell">{review.plannedPublishDate}</span>
        <span role="cell" className="history-row__status-cell">
          <span className="request-history-status" data-status={statusTone}>
            {label}
          </span>
        </span>
        <span role="cell">{review.reviewer || "미배정"}</span>
        <span role="cell" className={`history-row__action-cell ${styles.actionCell}`}>
          {hasActions ? (
            <>
              {hasOpinion ? (
                <button
                  type="button"
                  className="rejection-toggle"
                  aria-expanded={openPanel === "opinion"}
                  aria-label={openPanel === "opinion" ? `${opinionLabel} 접기` : `${opinionLabel} 펼치기`}
                  onClick={() => togglePanel("opinion")}
                >
                  {opinionLabel}
                </button>
              ) : null}
              {isRevisable ? (
                <button
                  type="button"
                  className="rejection-toggle"
                  aria-expanded={openPanel === "revision"}
                  aria-label={openPanel === "revision" ? "재검토 요청 접기" : "재검토 요청 펼치기"}
                  onClick={() => togglePanel("revision")}
                >
                  재검토 요청
                </button>
              ) : null}
              {isApproved ? (
                <button
                  type="button"
                  className="rejection-toggle"
                  aria-expanded={openPanel === "certificate"}
                  aria-label={openPanel === "certificate" ? "심의필 접기" : "심의필 보기"}
                  onClick={() => togglePanel("certificate")}
                >
                  심의필 보기
                </button>
              ) : null}
            </>
          ) : (
            <span className="history-row__empty-action" aria-label="작업 없음">
              -
            </span>
          )}
        </span>
      </div>

      {openPanel === "opinion" && hasOpinion ? (
        <div className="review-table__row review-table__row--rejection-note" role="row">
          <div role="cell" className="request-history-rejection-note" aria-label={opinionLabel}>
            <strong>{opinionLabel}</strong>
            <DraftNote text={review.currentDraft ?? ""} />
          </div>
        </div>
      ) : null}

      {openPanel === "revision" && isRevisable ? (
        <div className="review-table__row review-table__row--rejection-note" role="row">
          <div role="cell" className="request-history-rejection-note" aria-label="재검토 요청">
            <RevisionUploadPanel
              caseId={review.id}
              apiHeaders={apiHeaders}
              onSuccess={onRefresh}
            />
          </div>
        </div>
      ) : null}

      {openPanel === "certificate" && isApproved ? (
        <div className="review-table__row review-table__row--rejection-note" role="row">
          <div role="cell" className="request-history-rejection-note" aria-label="심의필">
            <CertificateView caseId={review.id} apiHeaders={apiHeaders} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatApprovedAt(value?: string): string {
  if (!value) return "-";
  const separatorIndex = value.indexOf("T");
  return separatorIndex > 0 ? value.slice(0, separatorIndex) : value;
}

type CertificateState =
  | { kind: "loading" }
  | { kind: "ready"; certificate: ReviewCertificate }
  | { kind: "not_issued" }
  | { kind: "error"; message: string };

function CertificateView({
  caseId,
  apiHeaders
}: {
  caseId: string;
  apiHeaders: ApiHeaders;
}): JSX.Element {
  const [state, setState] = useState<CertificateState>({ kind: "loading" });

  useEffect(() => {
    let mounted = true;

    async function loadCertificate(): Promise<void> {
      if (mounted) setState({ kind: "loading" });

      try {
        const response = await fetch(
          `/api/v1/review-cases/${encodeURIComponent(caseId)}/certificate`,
          {
            headers: apiHeaders()
          }
        );

        if (!mounted) return;

        if (response.status === 404) {
          setState({ kind: "not_issued" });
          return;
        }

        if (response.status === 403) {
          setState({ kind: "error", message: "심의필을 볼 권한이 없습니다." });
          return;
        }

        if (!response.ok) {
          setState({ kind: "error", message: "심의필을 불러오지 못했습니다." });
          return;
        }

        const body = (await response.json()) as { certificate?: ReviewCertificate };

        if (!mounted) return;

        if (!body.certificate) {
          setState({ kind: "not_issued" });
          return;
        }

        setState({ kind: "ready", certificate: body.certificate });
      } catch {
        if (mounted) {
          setState({ kind: "error", message: "심의필을 불러오지 못했습니다." });
        }
      }
    }

    void loadCertificate();

    return () => {
      mounted = false;
    };
  }, [caseId, apiHeaders]);

  if (state.kind === "loading") {
    return (
      <p className={styles.stateText} role="status">
        <Loader2 className="action-spinner" size={16} aria-hidden="true" />
        심의필을 불러오는 중입니다.
      </p>
    );
  }

  if (state.kind === "not_issued") {
    return <p className={styles.stateText}>심의필 발급 전입니다.</p>;
  }

  if (state.kind === "error") {
    return (
      <p className={styles.stateText} role="alert">
        {state.message}
      </p>
    );
  }

  const { certificate } = state;
  const meta = certificate.metadata;

  return (
    <div className={styles.certCard}>
      <div className={styles.certHeader}>
        <span className={styles.certNumber}>심의필번호 {certificate.certificateNumber}</span>
        <dl className={styles.certMeta}>
          <dt className={styles.certMetaLabel}>케이스</dt>
          <dd className={styles.certMetaValue}>{meta.title}</dd>
          <dt className={styles.certMetaLabel}>상품유형</dt>
          <dd className={styles.certMetaValue}>
            {meta.productType ? productLabels[meta.productType] : "-"}
          </dd>
          <dt className={styles.certMetaLabel}>승인일</dt>
          <dd className={styles.certMetaValue}>{formatApprovedAt(meta.approvedAt)}</dd>
          <dt className={styles.certMetaLabel}>심의자</dt>
          <dd className={styles.certMetaValue}>
            {meta.reviewerName || certificate.issuedByName || "-"}
          </dd>
        </dl>
      </div>
      <div className={styles.certBody}>{certificate.body}</div>
    </div>
  );
}
