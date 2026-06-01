import type { EvidenceChunk, KnowledgeDocument, RegulatorySourceStatus } from "./types";

type EffectiveDateRange = {
  effectiveFrom?: string;
  effectiveTo?: string;
};

export function isActiveKnowledgeDocument(document: KnowledgeDocument): boolean {
  return (
    document.approvalStatus === "approved" &&
    (document.lifecycleStatus === "active" || document.lifecycleStatus === undefined)
  );
}

export function isActiveEvidenceChunk(chunk: EvidenceChunk): boolean {
  return chunk.chunkStatus === "active" || chunk.chunkStatus === undefined;
}

export function appliesToEffectiveDate(range: EffectiveDateRange, plannedPublishDate: string): boolean {
  const plannedDate = parseUtcDateOnly(plannedPublishDate);

  if (range.effectiveFrom && plannedDate < parseUtcDateOnly(range.effectiveFrom)) {
    return false;
  }

  if (range.effectiveTo && plannedDate > parseUtcDateOnly(range.effectiveTo)) {
    return false;
  }

  return true;
}

export function regulatorySourceStatusLabel(status: RegulatorySourceStatus): string {
  const labels: Record<RegulatorySourceStatus, string> = {
    active: "정상",
    failing: "수집 실패",
    paused: "중지"
  };

  return labels[status];
}

function parseUtcDateOnly(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
}
