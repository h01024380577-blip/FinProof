"use client";

import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReviewCase, ReviewSummary } from "@/domain/types";
import { QueueMetrics, type QueueMetricValues } from "./queue/QueueMetrics";
import { QueueFilters, type QueueFilterState } from "./queue/QueueFilters";
import { QueueTable } from "./queue/QueueTable";
import { useRole } from "./RoleContext";

type ReviewCasesResponse = { reviewCases: ReviewSummary[] };
type AnalysisStartResponse = {
  reviewCaseId: string;
  status: ReviewCase["status"];
  analysisHref: string;
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

function defaultFiltersForScope(scope: "active" | "history"): QueueFilterState {
  return scope === "history" ? { ...defaultFilterState, status: "approved" } : defaultFilterState;
}

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
  const [filters, setFilters] = useState<QueueFilterState>(defaultFilterState);
  const [historyDecision, setHistoryDecision] = useState<HistoryDecision>("approved");

  const displayedFilters = useMemo(
    () =>
      scope === "history" && filters.status !== "approved" && filters.status !== "rejected"
        ? { ...filters, status: historyDecision }
        : filters,
    [filters, historyDecision, scope]
  );

  const scopedReviews = useMemo(
    () =>
      reviews.filter((review) =>
        scope === "history"
          ? review.status === historyDecision
          : !isFinalizedReview(review.status)
      ),
    [historyDecision, reviews, scope]
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
    const q = normalizeSearch(displayedFilters.search);
    return scopedReviews.filter((review) => {
      const waiting = isAnalysisWaiting(review.status);
      const matchesQ =
        q.length === 0 ||
        [review.id, review.title, review.affiliate, review.requester, review.reviewer]
          .join(" ")
          .toLocaleLowerCase("ko-KR")
          .includes(q);
      const matchesStatus =
        displayedFilters.status === "all" || review.status === displayedFilters.status;
      const matchesRisk =
        displayedFilters.risk === "all" ||
        (displayedFilters.risk === "analysis_pending"
          ? waiting
          : review.highestRiskLevel === displayedFilters.risk);
      const matchesProduct =
        displayedFilters.product === "all" || review.productType === displayedFilters.product;
      return matchesQ && matchesStatus && matchesRisk && matchesProduct;
    });
  }, [displayedFilters, scopedReviews]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mounted) {
        setIsLoading(true);
        setLoadError(null);
      }
      try {
        const response = await fetch("/api/v1/review-cases", {
          headers: apiHeaders()
        });
        if (!response.ok) throw new Error("심의 큐를 불러오지 못했습니다.");
        const body = (await response.json()) as ReviewCasesResponse;
        if (mounted) setReviews(body.reviewCases);
      } catch (error) {
        if (mounted)
          setLoadError(error instanceof Error ? error.message : "심의 큐를 불러오지 못했습니다.");
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeRole, apiHeaders]);

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
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "분석 시작 요청을 처리하지 못했습니다."
      );
    } finally {
      setActiveAnalysisId(null);
    }
  }

  function selectHistoryDecision(decision: HistoryDecision): void {
    setHistoryDecision(decision);
    setFilters((current) => ({ ...current, status: decision }));
  }

  function handleFilterChange(next: QueueFilterState): void {
    if (scope === "history" && (next.status === "approved" || next.status === "rejected")) {
      setHistoryDecision(next.status);
    }
    setFilters(next);
  }

  function resetFilters(): void {
    const nextFilters = defaultFiltersForScope(scope);
    setFilters(nextFilters);
    if (scope === "history") {
      setHistoryDecision("approved");
    }
  }

  return (
    <div className="review-queue">
      <section className="queue-head">
        <div>
          <h2>{scope === "history" ? "심의 이력" : "심의 큐"}</h2>
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
            const selected = historyDecision === decision.key;

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
          state={displayedFilters}
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
          emptyMessage={
            scopedReviews.length > 0
              ? "검색 또는 필터 조건에 맞는 심의 건이 없습니다."
              : scope === "history"
                ? `아직 ${historyDecision === "approved" ? "승인 완료" : "반려 완료"}된 심의 이력이 없습니다.`
                : "아직 심의 요청이 없습니다. 새 심의 요청을 생성해 자료 패키지를 업로드하세요."
          }
          onStartAnalysis={(review) => void startAnalysis(review)}
          onOpenReview={(id) => router.push(`/reviews/${id}`)}
        />
      </section>
    </div>
  );
}
