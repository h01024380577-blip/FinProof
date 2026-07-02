import type { Evidence } from "./types";

export const MIN_MATCHED_EVIDENCE_SCORE = 0.5;

// Knowledge-corpus evidence (law / internal_policy) uses a lower attachment floor than
// product docs: the Cohere reranker systematically under-scores Korean regulation text
// (routinely 0.03–0.35), so an on-point checklist that is the correct basis for an issue
// would otherwise be dropped by MIN_MATCHED_EVIDENCE_SCORE and the issue would fall back to
// citing only the ad itself. Mirrors the retrieval/selection knowledge floors.
export const KNOWLEDGE_MATCHED_EVIDENCE_SCORE = 0.1;

export function isMatchedEvidence(evidence: Pick<Evidence, "relevanceScore">) {
  return evidence.relevanceScore >= MIN_MATCHED_EVIDENCE_SCORE;
}

export function filterMatchedEvidence<T extends Pick<Evidence, "relevanceScore">>(
  evidence: T[]
): T[] {
  return evidence.filter(isMatchedEvidence);
}
