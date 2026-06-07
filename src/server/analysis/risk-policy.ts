import type { ReviewIssue, RiskLevel } from "@/domain/types";
import { COMMON_RISK_POLICY_PROMPT } from "@/server/ai/prompt-registry";

export const analysisRiskLevels = ["info", "caution", "high"] as const;

export const riskRank: Record<RiskLevel, number> = {
  info: 0,
  caution: 1,
  high: 2
};

export function normalizeAnalysisRiskLevel(
  value: unknown,
  fallback: RiskLevel = "caution"
): RiskLevel {
  if (value === "info" || value === "caution" || value === "high") {
    return value;
  }

  if (value === "reject_recommended") {
    return "high";
  }

  return fallback;
}

export function normalizeAiSuggestedAction(value: unknown): ReviewIssue["suggestedAction"] {
  if (value === "approve" || value === "change_request" || value === "hold") {
    return value;
  }

  if (value === "reject") {
    return "change_request";
  }

  return "change_request";
}

export const evidenceBoundRiskPolicy = COMMON_RISK_POLICY_PROMPT;
