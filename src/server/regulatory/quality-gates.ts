import type { QualityGateResult, QualityGateStatus, QualityGateType, RegulatoryChangeSet } from "@/domain/types";

type RunQualityGatesInput = {
  changeSet: RegulatoryChangeSet;
  regressionRetrieved: boolean;
  rollbackTargetReady: boolean;
  now?: () => Date;
};

function result(
  changeSetId: string,
  gateType: QualityGateType,
  status: QualityGateStatus,
  summary: string,
  evidence: Record<string, unknown>,
  createdAt: string
): QualityGateResult {
  return {
    id: `gate-${changeSetId}-${gateType}`,
    changeSetId,
    gateType,
    status,
    summary,
    evidence,
    createdAt
  };
}

function hasCitation(changeSet: RegulatoryChangeSet): boolean {
  return changeSet.changedSections.every(
    (section) => section.citation.snapshotId.trim().length > 0 && section.citation.sectionId.trim().length > 0
  );
}

function hasRequiredSchema(changeSet: RegulatoryChangeSet): boolean {
  return (
    changeSet.changeSummary.trim().length > 0 &&
    changeSet.changedSections.length > 0 &&
    changeSet.interpretationSummary.trim().length > 0 &&
    changeSet.mappedProductTypes.length > 0 &&
    changeSet.mappedReviewCategories.length > 0 &&
    changeSet.confidence >= 0 &&
    changeSet.confidence <= 1
  );
}

function hasValidEffectiveDate(changeSet: RegulatoryChangeSet): boolean {
  if (!changeSet.effectiveFrom) {
    return true;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(changeSet.effectiveFrom)) {
    return false;
  }

  const date = new Date(`${changeSet.effectiveFrom}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === changeSet.effectiveFrom;
}

function hasPotentialContradiction(changeSet: RegulatoryChangeSet): boolean {
  const changedSectionText = changeSet.changedSections
    .flatMap((section) => [section.title, section.diffSummary, section.previousText, section.newText])
    .filter((text): text is string => Boolean(text))
    .join(" ");
  const text = `${changeSet.changeSummary} ${changeSet.interpretationSummary} ${changedSectionText}`.toLowerCase();

  return text.includes("상위 규제와 충돌") || text.includes("conflict with higher priority");
}

export function runRegulatoryQualityGates({
  changeSet,
  regressionRetrieved,
  rollbackTargetReady,
  now = () => new Date()
}: RunQualityGatesInput): QualityGateResult[] {
  const createdAt = now().toISOString();

  return [
    result(
      changeSet.id,
      "citation_coverage",
      hasCitation(changeSet) ? "passed" : "failed",
      hasCitation(changeSet) ? "모든 변경 섹션에 원문 citation이 있습니다." : "citation이 없는 변경 섹션이 있습니다.",
      { changedSectionCount: changeSet.changedSections.length },
      createdAt
    ),
    result(
      changeSet.id,
      "schema_validation",
      hasRequiredSchema(changeSet) ? "passed" : "failed",
      hasRequiredSchema(changeSet) ? "필수 구조화 필드가 채워졌습니다." : "필수 구조화 필드가 비어 있습니다.",
      {
        mappedProductTypes: changeSet.mappedProductTypes,
        mappedReviewCategories: changeSet.mappedReviewCategories
      },
      createdAt
    ),
    result(
      changeSet.id,
      "contradiction_check",
      hasPotentialContradiction(changeSet) ? "flagged" : "passed",
      hasPotentialContradiction(changeSet) ? "상위 기준 충돌 가능성이 감지되었습니다." : "상위 기준 충돌 신호가 없습니다.",
      { sourceId: changeSet.sourceId },
      createdAt
    ),
    result(
      changeSet.id,
      "retrieval_regression",
      regressionRetrieved ? "passed" : "failed",
      regressionRetrieved ? "대표 검색 질의에서 신규 지식 청크가 검색됩니다." : "대표 검색 질의에서 신규 지식 청크가 검색되지 않았습니다.",
      { regressionRetrieved },
      createdAt
    ),
    result(
      changeSet.id,
      "effective_date",
      hasValidEffectiveDate(changeSet) ? "passed" : "failed",
      hasValidEffectiveDate(changeSet) ? "시행일 형식이 유효합니다." : "시행일 형식이 유효하지 않습니다.",
      { effectiveFrom: changeSet.effectiveFrom },
      createdAt
    ),
    result(
      changeSet.id,
      "rollback_ready",
      rollbackTargetReady ? "passed" : "failed",
      rollbackTargetReady ? "롤백 대상이 확인되었습니다." : "롤백 대상이 확인되지 않았습니다.",
      { rollbackTargetReady },
      createdAt
    )
  ];
}

export function qualityGateStatus(results: QualityGateResult[]): QualityGateStatus {
  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }

  if (results.some((result) => result.status === "flagged")) {
    return "flagged";
  }

  return "passed";
}
