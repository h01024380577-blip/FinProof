import { riskLabels, statusLabels } from "@/domain/reviews";
import type { ReviewCase, RiskLevel } from "@/domain/types";

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className="risk-badge" data-risk={level}>
      {riskLabels[level]}
    </span>
  );
}

export function StatusBadge({ status }: { status: ReviewCase["status"] }) {
  const isAnalysisWaiting = status === "analysis_waiting";
  const isAnalysisComplete = status === "analysis_complete";
  const className = [
    "status-badge",
    `status-badge--${status.replaceAll("_", "-")}`,
    isAnalysisWaiting || isAnalysisComplete ? "status-badge--plain" : "",
    isAnalysisComplete ? "status-badge--weight-strong" : "",
    isAnalysisWaiting ? "status-badge--weight-regular" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={className}
      data-status={status}
    >
      {statusLabels[status]}
    </span>
  );
}
