import type { Evidence } from "./types";

export const MIN_MATCHED_EVIDENCE_SCORE = 0.5;

export function isMatchedEvidence(evidence: Pick<Evidence, "relevanceScore">) {
  return evidence.relevanceScore >= MIN_MATCHED_EVIDENCE_SCORE;
}

export function filterMatchedEvidence<T extends Pick<Evidence, "relevanceScore">>(
  evidence: T[]
): T[] {
  return evidence.filter(isMatchedEvidence);
}
