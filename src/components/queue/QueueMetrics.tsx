"use client";

import type { JSX } from "react";
import { KpiCard } from "@/components/ui";

export type QueueMetricValues = {
  analysisWaiting: number;
  inReview: number;
  rejectRecommended: number;
  dueSoon: number;
};

export type QueueMetricsProps = {
  metrics: QueueMetricValues;
  onSelectRejectRecommended?: () => void;
  onSelectDueSoon?: () => void;
};

export function QueueMetrics({
  metrics,
  onSelectRejectRecommended,
  onSelectDueSoon
}: QueueMetricsProps): JSX.Element {
  return (
    <section className="queue-metrics" aria-label="Review queue metrics">
      <KpiCard label="분석 대기" value={metrics.analysisWaiting} tone="primary" />
      <KpiCard label="검토 중" value={metrics.inReview} tone="primary" />
      <KpiCard
        label="반려 권고"
        value={metrics.rejectRecommended}
        tone="danger"
        onClick={onSelectRejectRecommended}
      />
      <KpiCard
        label="마감 임박"
        value={metrics.dueSoon}
        tone="warning"
        onClick={onSelectDueSoon}
      />
    </section>
  );
}
