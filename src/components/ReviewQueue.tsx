"use client";

import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
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

export function ReviewQueue(): JSX.Element {
  const { activeRole, apiHeaders } = useRole();
  const router = useRouter();
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [filters, setFilters] = useState<QueueFilterState>(defaultFilterState);

  const metrics: QueueMetricValues = useMemo(
    () => ({
      analysisWaiting: reviews.filter((r) => isAnalysisWaiting(r.status)).length,
      inReview: reviews.filter(
        (r) => r.status === "analysis_complete" || r.status === "under_review"
      ).length,
      rejectRecommended: reviews.filter((r) => r.highestRiskLevel === "reject_recommended").length,
      dueSoon: reviews.filter((r) => r.plannedPublishDate <= "2026-06-12").length
    }),
    [reviews]
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(filters.search);
    return reviews.filter((review) => {
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
  }, [filters, reviews]);

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

  return (
    <div className="review-queue">
      <section className="queue-head">
        <div>
          <h2>심의 큐</h2>
          <p>업로드된 심의 요청을 확인하고 분석 대기 건을 배정합니다.</p>
        </div>
        <Link className="button button--primary" href="/reviews/new">
          <FilePlus2 size={16} aria-hidden="true" />새 심의 요청
        </Link>
      </section>

      <QueueMetrics
        metrics={metrics}
        onSelectRejectRecommended={() => setFilters((f) => ({ ...f, risk: "reject_recommended" }))}
        onSelectDueSoon={() => setFilters((f) => ({ ...f, status: "all", risk: "all" }))}
      />

      <section className="queue-panel">
        <QueueFilters
          state={filters}
          onChange={setFilters}
          onReset={() => setFilters(defaultFilterState)}
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
            reviews.length > 0
              ? "검색 또는 필터 조건에 맞는 심의 건이 없습니다."
              : "아직 심의 요청이 없습니다. 새 심의 요청을 생성해 자료 패키지를 업로드하세요."
          }
          onStartAnalysis={(review) => void startAnalysis(review)}
          onOpenReview={(id) => router.push(`/reviews/${id}`)}
        />
      </section>
    </div>
  );
}
