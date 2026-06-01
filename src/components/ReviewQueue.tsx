"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReviewCase, ReviewSummary } from "@/domain/types";
import { QueueMetrics, type QueueMetricValues } from "./queue/QueueMetrics";
import { QueueFilters, type QueueFilterState } from "./queue/QueueFilters";
import { QueueTable } from "./queue/QueueTable";
import { useRole } from "./RoleContext";

type ReviewCasesResponse = {
  items?: ReviewSummary[];
  reviewCases?: ReviewSummary[];
  page?: number;
  pageSize?: number;
  total?: number;
};
type AnalysisStartResponse = {
  reviewCaseId: string;
  status: ReviewCase["status"];
  analysisHref: string;
};
type ReviewerUpdateResponse = {
  reviewCase?: Pick<ReviewCase, "id" | "reviewer">;
};

function isAnalysisWaiting(status: ReviewCase["status"]): boolean {
  return status === "submitted" || status === "analysis_waiting";
}

function fallbackActionsFor(
  role: ReturnType<typeof useRole>["activeRole"],
  status: ReviewCase["status"]
) {
  if (status === "analysis_waiting" && (role === "reviewer" || role === "compliance_admin")) {
    return ["start_analysis" as const];
  }
  if (
    status === "analysis_complete" ||
    status === "under_review" ||
    status === "change_requested" ||
    status === "rejected" ||
    status === "approved" ||
    status === "on_hold"
  ) {
    return status === "analysis_complete"
      ? (["open_workbench", "view_audit"] as const)
      : (["view_audit"] as const);
  }
  return [];
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

const defaultFilterState: QueueFilterState = {
  search: "",
  status: "all",
  risk: "all",
  product: "all"
};
const queuePageSize = 10;


const finalizedStatuses = new Set<ReviewCase["status"]>(["approved", "rejected"]);

type HistoryDecision = "approved" | "rejected";

const historyDecisions: Array<{
  key: HistoryDecision;
  label: string;
  tone: "success" | "danger";
}> = [
  { key: "approved", label: "승인 완료", tone: "success" },
  { key: "rejected", label: "반려 완료", tone: "danger" }
];

function isFinalizedReview(status: ReviewCase["status"]): boolean {
  return finalizedStatuses.has(status);
}

export function ReviewQueue(): JSX.Element {
  const { activeRole, apiHeaders } = useRole();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope") === "history" ? "history" : "active";
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const pollingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [savingReviewerIds, setSavingReviewerIds] = useState<string[]>([]);
  const [deletingHistoryIds, setDeletingHistoryIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<QueueFilterState>(defaultFilterState);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: queuePageSize,
    total: 0
  });
  const listLabel = scope === "history" ? "심의 이력" : "심의 대기 목록";
  const loadingMessage = `${listLabel}을 불러오는 중입니다.`;
  const canEditReviewer =
    scope === "active" && (activeRole === "reviewer" || activeRole === "compliance_admin");
  const canDeleteReviewHistory =
    scope === "history" && (activeRole === "reviewer" || activeRole === "compliance_admin");

  const scopedReviews = useMemo(
    () =>
      reviews.filter((review) =>
        scope === "history" ? isFinalizedReview(review.status) : !isFinalizedReview(review.status)
      ),
    [reviews, scope]
  );

  const metrics: QueueMetricValues = useMemo(
    () => ({
      analysisWaiting: scopedReviews.filter((r) => isAnalysisWaiting(r.status)).length,
      inReview: scopedReviews.filter(
        (r) => r.status === "analysis_complete" || r.status === "under_review"
      ).length,
      rejectRecommended: scopedReviews.filter((r) => r.highestRiskLevel === "reject_recommended")
        .length,
      dueSoon: scopedReviews.filter((r) => r.plannedPublishDate <= "2026-06-12").length
    }),
    [scopedReviews]
  );

  const historyDecisionCounts = useMemo(
    () => ({
      approved: reviews.filter((review) => review.status === "approved").length,
      rejected: reviews.filter((review) => review.status === "rejected").length
    }),
    [reviews]
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(filters.search);
    return scopedReviews.filter((review) => {
      const waiting = isAnalysisWaiting(review.status);
      const matchesQ =
        q.length === 0 ||
        [review.id, review.title, review.affiliate, review.requester, review.reviewer]
          .join(" ")
          .toLocaleLowerCase("ko-KR")
          .includes(q);
      const matchesStatus = filters.status === "all" || review.status === filters.status;
      const matchesRisk =
        filters.risk === "all" ||
        (filters.risk === "analysis_pending" ? waiting : review.highestRiskLevel === filters.risk);
      const matchesProduct = filters.product === "all" || review.productType === filters.product;
      return matchesQ && matchesStatus && matchesRisk && matchesProduct;
    });
  }, [filters, scopedReviews]);

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mounted) {
        setIsLoading(true);
        setLoadError(null);
      }
      try {
        const response = await fetch(reviewCasesUrl(page, filters), {
          headers: apiHeaders()
        });
        if (!response.ok) throw new Error(`${listLabel}을 불러오지 못했습니다.`);
        const body = (await response.json()) as ReviewCasesResponse;
        if (mounted) {
          const rows = body.reviewCases ?? body.items ?? [];
          setReviews(rows);
          setPagination({
            page: body.page ?? page,
            pageSize: body.pageSize ?? queuePageSize,
            total: body.total ?? rows.length
          });
        }
      } catch (error) {
        if (mounted)
          setLoadError(
            error instanceof Error ? error.message : `${listLabel}을 불러오지 못했습니다.`
          );
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeRole, apiHeaders, filters, listLabel, page]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      ) {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="검색"]');
        if (input) {
          event.preventDefault();
          input.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const timers = pollingTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  async function pollForCompletion(reviewId: string, attempt = 0): Promise<void> {
    const MAX_ATTEMPTS = 90; // ~3 minutes at 2s intervals
    if (attempt >= MAX_ATTEMPTS) {
      setActiveAnalysisId(null);
      pollingTimers.current.delete(reviewId);
      return;
    }

    try {
      const response = await fetch(`/api/v1/review-cases/${reviewId}`, {
        headers: apiHeaders()
      });
      if (response.ok) {
        const body = (await response.json()) as { reviewCase: ReviewCase };
        const { status } = body.reviewCase;
        const isTerminal =
          status === "analysis_complete" ||
          status === "under_review" ||
          status === "approved" ||
          status === "rejected" ||
          status === "change_requested" ||
          status === "on_hold";

        if (isTerminal) {
          setReviews((current) =>
            current.map((candidate) =>
              candidate.id === reviewId
                ? {
                    ...candidate,
                    status,
                    availableActions: fallbackActionsFor(
                      activeRole,
                      status
                    ) as unknown as ReviewSummary["availableActions"]
                  }
                : candidate
            )
          );
          setActiveAnalysisId(null);
          pollingTimers.current.delete(reviewId);
          return;
        }
      }
    } catch {
      // swallow and retry
    }

    const timer = setTimeout(() => void pollForCompletion(reviewId, attempt + 1), 2000);
    pollingTimers.current.set(reviewId, timer);
  }

  async function startAnalysis(review: ReviewSummary): Promise<void> {
    setActiveAnalysisId(review.id);
    setLoadError(null);
    try {
      const response = await fetch(`/api/v1/review-cases/${review.id}/analysis/start`, {
        method: "POST",
        headers: apiHeaders()
      });
      if (!response.ok) throw new Error("분석 시작 권한 또는 요청을 확인해 주세요.");
      const body = (await response.json()) as AnalysisStartResponse;

      if (body.status === "analysis_complete") {
        setReviews((current) =>
          current.map((candidate) =>
            candidate.id === review.id
              ? {
                  ...candidate,
                  status: body.status,
                  availableActions: fallbackActionsFor(
                    activeRole,
                    body.status
                  ) as unknown as ReviewSummary["availableActions"]
                }
              : candidate
          )
        );
        setActiveAnalysisId(null);
      } else {
        setReviews((current) =>
          current.map((candidate) =>
            candidate.id === review.id ? { ...candidate, status: body.status } : candidate
          )
        );
        void pollForCompletion(review.id);
      }
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "분석 시작 요청을 처리하지 못했습니다."
      );
      setActiveAnalysisId(null);
    }
  }

  async function saveReviewer(review: ReviewSummary, reviewer: string): Promise<void> {
    setSavingReviewerIds((current) =>
      current.includes(review.id) ? current : [...current, review.id]
    );
    setLoadError(null);

    try {
      const response = await fetch(`/api/v1/review-cases/${review.id}`, {
        method: "PATCH",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ reviewer })
      });

      if (!response.ok) {
        throw new Error("담당자 저장 권한 또는 요청을 확인해 주세요.");
      }

      const body = (await response.json()) as ReviewerUpdateResponse;
      const savedReviewer = body.reviewCase?.reviewer ?? reviewer;

      setReviews((current) =>
        current.map((candidate) =>
          candidate.id === review.id ? { ...candidate, reviewer: savedReviewer } : candidate
        )
      );
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "담당자 저장 요청을 처리하지 못했습니다."
      );
    } finally {
      setSavingReviewerIds((current) => current.filter((id) => id !== review.id));
    }
  }

  async function deleteReviewHistory(review: ReviewSummary): Promise<void> {
    const confirmed = window.confirm(
      "이 심의 이력을 삭제하시겠습니까? 삭제 후에는 목록에서 사라집니다."
    );

    if (!confirmed) {
      return;
    }

    setDeletingHistoryIds((current) =>
      current.includes(review.id) ? current : [...current, review.id]
    );
    setLoadError(null);

    try {
      const response = await fetch(`/api/v1/review-cases/${review.id}`, {
        method: "DELETE",
        headers: apiHeaders()
      });

      if (!response.ok) {
        throw new Error("심의 이력 삭제 권한 또는 요청을 확인해 주세요.");
      }

      setReviews((current) => current.filter((candidate) => candidate.id !== review.id));
      setPagination((current) => ({
        ...current,
        total: Math.max(0, current.total - 1)
      }));
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "심의 이력 삭제 요청을 처리하지 못했습니다."
      );
    } finally {
      setDeletingHistoryIds((current) => current.filter((id) => id !== review.id));
    }
  }

  function selectHistoryDecision(decision: HistoryDecision): void {
    setPage(1);
    setFilters((current) => ({ ...current, status: decision }));
  }

  function handleFilterChange(next: QueueFilterState): void {
    setPage(1);
    setFilters(next);
  }

  function resetFilters(): void {
    setPage(1);
    setFilters(defaultFilterState);
  }

  return (
    <div className="review-queue">
      <section className="queue-head">
        <div>
          <h2>{scope === "history" ? "심의 이력" : "심의 대기 목록"}</h2>
          <p>
            {scope === "history"
              ? "승인 또는 반려 판단이 완료된 심의 건을 확인합니다."
              : "업로드된 심의 요청을 확인하고 분석 대기 건을 배정합니다."}
          </p>
        </div>
      </section>

      {scope === "active" ? (
        <QueueMetrics
          metrics={metrics}
          onSelectRejectRecommended={() =>
            setFilters((f) => ({ ...f, risk: "reject_recommended" }))
          }
          onSelectDueSoon={() => setFilters((f) => ({ ...f, status: "all", risk: "all" }))}
        />
      ) : null}

      {scope === "history" ? (
        <div className="history-decision-tabs" role="tablist" aria-label="심의 이력 구분">
          {historyDecisions.map((decision) => {
            const selected = filters.status === decision.key;

            return (
              <button
                key={decision.key}
                type="button"
                role="tab"
                aria-label={decision.label}
                aria-selected={selected}
                className="kpi-card kpi-card--button history-decision-card"
                data-active={selected}
                data-tone={decision.tone}
                onClick={() => selectHistoryDecision(decision.key)}
              >
                <span className="kpi-card__label">{decision.label}</span>
                <strong className="kpi-card__value">{historyDecisionCounts[decision.key]}</strong>
              </button>
            );
          })}
        </div>
      ) : null}

      <section className="queue-panel">
        <QueueFilters
          state={filters}
          mode={scope}
          onChange={handleFilterChange}
          onReset={resetFilters}
        />

        {loadError ? (
          <p className="interaction-error" role="alert">
            {loadError}
          </p>
        ) : null}

        <QueueTable
          rows={filtered}
          activeRole={activeRole}
          activeAnalysisId={activeAnalysisId}
          isLoading={isLoading}
          loadingMessage={loadingMessage}
          canEditReviewer={canEditReviewer}
          savingReviewerIds={savingReviewerIds}
          canDeleteReviewHistory={canDeleteReviewHistory}
          deletingReviewHistoryIds={deletingHistoryIds}
          emptyMessage={
            scopedReviews.length > 0
              ? "검색 또는 필터 조건에 맞는 심의 건이 없습니다."
              : scope === "history"
                ? filters.status === "approved"
                  ? "아직 승인 완료된 심의 이력이 없습니다."
                  : filters.status === "rejected"
                    ? "아직 반려 완료된 심의 이력이 없습니다."
                    : "아직 심의 이력이 없습니다."
                : "아직 심의 요청이 없습니다. 새 심의 요청을 생성해 자료 패키지를 업로드하세요."
          }
          onSaveReviewer={(review, reviewer) => void saveReviewer(review, reviewer)}
          onDeleteReviewHistory={(review) => void deleteReviewHistory(review)}
          onStartAnalysis={(review) => void startAnalysis(review)}
          onOpenReview={(id) => router.push(`/reviews/${id}`)}
        />
        {pagination.total > pagination.pageSize ? (
          <div className="queue-pagination" aria-label="심의 대기 목록 페이지네이션">
            <button
              className="button button--small"
              type="button"
              disabled={pagination.page <= 1 || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              이전 페이지
            </button>
            <span>
              {pagination.page} / {totalPages}
            </span>
            <button
              className="button button--small"
              type="button"
              disabled={pagination.page >= totalPages || isLoading}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              다음 페이지
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function reviewCasesUrl(page: number, filters: QueueFilterState): string {
  const params = new URLSearchParams();
  const hasServerFilter =
    filters.status !== "all" ||
    filters.product !== "all" ||
    (filters.risk !== "all" && filters.risk !== "analysis_pending");

  if (page > 1 || hasServerFilter) {
    params.set("page", String(page));
    params.set("pageSize", String(queuePageSize));
  }

  if (filters.status !== "all") {
    params.set("status", filters.status);
  }

  if (filters.product !== "all") {
    params.set("productType", filters.product);
  }

  if (filters.risk !== "all" && filters.risk !== "analysis_pending") {
    params.set("riskLevel", filters.risk);
  }

  const query = params.toString();

  return query ? `/api/v1/review-cases?${query}` : "/api/v1/review-cases";
}
