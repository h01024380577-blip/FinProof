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
  return (
    <span className="status-badge" data-status={status}>
      {statusLabels[status]}
    </span>
  );
}
