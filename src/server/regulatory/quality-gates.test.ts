import type { QualityGateResult, RegulatoryChangeSet } from "@/domain/types";
import { qualityGateStatus, runRegulatoryQualityGates } from "./quality-gates";

function changeSet(overrides: Partial<RegulatoryChangeSet> = {}): RegulatoryChangeSet {
  return {
    id: "change-set-001",
    tenantId: "tenant-demo",
    sourceId: "source-001",
    previousSnapshotId: "snapshot-old",
    newSnapshotId: "snapshot-new",
    changeType: "amended",
    changeSummary: "최고금리 표시 기준이 강화되었습니다.",
    changedSections: [
      {
        sectionId: "section-002",
        sectionNumber: "제2조",
        title: "최고금리 표시",
        previousText: "최고금리 표현 시 우대조건을 표시해야 한다.",
        newText: "최고금리 표현 시 기본금리, 우대조건, 적용 한도를 인접 영역에 표시해야 한다.",
        diffSummary: "기존 조항의 문구 또는 적용 범위가 변경되었습니다.",
        citation: { snapshotId: "snapshot-new", sectionId: "section-002" }
      }
    ],
    effectiveFrom: "2026-07-01",
    riskImpactLevel: "high",
    interpretationSummary: "최고금리 단독 강조 광고는 필수 조건 인접 고지가 필요합니다.",
    mappedProductTypes: ["deposit"],
    mappedChannels: ["mobile_banner"],
    mappedReviewCategories: ["rate_display"],
    qualityGateStatus: "passed",
    confidence: 0.91,
    createdAt: "2026-05-31T00:00:00.000Z",
    ...overrides
  };
}

describe("runRegulatoryQualityGates", () => {
  it("passes a cited, structured, date-safe change set", () => {
    const results = runRegulatoryQualityGates({
      changeSet: changeSet(),
      regressionRetrieved: true,
      rollbackTargetReady: true
    });

    expect(results.map((result) => [result.gateType, result.status])).toEqual([
      ["citation_coverage", "passed"],
      ["schema_validation", "passed"],
      ["contradiction_check", "passed"],
      ["retrieval_regression", "passed"],
      ["effective_date", "passed"],
      ["rollback_ready", "passed"]
    ]);
  });

  it("fails citation and retrieval gates when evidence is not grounded", () => {
    const results = runRegulatoryQualityGates({
      changeSet: changeSet({
        changedSections: [
          {
            sectionId: "section-002",
            title: "최고금리 표시",
            diffSummary: "근거 없는 변경입니다.",
            citation: { snapshotId: "", sectionId: "" }
          }
        ]
      }),
      regressionRetrieved: false,
      rollbackTargetReady: true
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gateType: "citation_coverage", status: "failed" }),
        expect.objectContaining({ gateType: "retrieval_regression", status: "failed" })
      ])
    );
  });

  it("flags contradictions found only in changed section fields", () => {
    const results = runRegulatoryQualityGates({
      changeSet: changeSet({
        changedSections: [
          {
            sectionId: "section-002",
            title: "최고금리 표시",
            previousText: "기존 기준입니다.",
            newText: "상위 규제와 충돌 가능성이 있는 변경입니다.",
            diffSummary: "기존 조항의 문구 또는 적용 범위가 변경되었습니다.",
            citation: { snapshotId: "snapshot-new", sectionId: "section-002" }
          }
        ]
      }),
      regressionRetrieved: true,
      rollbackTargetReady: true
    });

    expect(results).toEqual(
      expect.arrayContaining([expect.objectContaining({ gateType: "contradiction_check", status: "flagged" })])
    );
  });

  it("captures one clock value for all gate result timestamps", () => {
    let callCount = 0;

    const results = runRegulatoryQualityGates({
      changeSet: changeSet(),
      regressionRetrieved: true,
      rollbackTargetReady: true,
      now: () => new Date(`2026-05-31T12:34:5${callCount++}.000Z`)
    });

    expect(results.map((result) => result.createdAt)).toEqual(results.map(() => "2026-05-31T12:34:50.000Z"));
    expect(callCount).toBe(1);
  });

  it.each(["2026-13-01", "2026-02-31", "2026-07-01abc"])(
    "fails effective date validation for invalid date %s",
    (effectiveFrom) => {
      const results = runRegulatoryQualityGates({
        changeSet: changeSet({ effectiveFrom }),
        regressionRetrieved: true,
        rollbackTargetReady: true
      });

      expect(results).toEqual(
        expect.arrayContaining([expect.objectContaining({ gateType: "effective_date", status: "failed" })])
      );
    }
  );

  it("fails citation coverage for whitespace-only citation ids", () => {
    const results = runRegulatoryQualityGates({
      changeSet: changeSet({
        changedSections: [
          {
            sectionId: "section-002",
            title: "최고금리 표시",
            diffSummary: "근거 없는 변경입니다.",
            citation: { snapshotId: "   ", sectionId: "\t" }
          }
        ]
      }),
      regressionRetrieved: true,
      rollbackTargetReady: true
    });

    expect(results).toEqual(
      expect.arrayContaining([expect.objectContaining({ gateType: "citation_coverage", status: "failed" })])
    );
  });
});

describe("qualityGateStatus", () => {
  function gate(status: QualityGateResult["status"]): QualityGateResult {
    return {
      id: `gate-${status}`,
      changeSetId: "change-set-001",
      gateType: "schema_validation",
      status,
      summary: status,
      evidence: {},
      createdAt: "2026-05-31T00:00:00.000Z"
    };
  }

  it("prioritizes failed over flagged and passed", () => {
    expect(qualityGateStatus([gate("passed"), gate("flagged"), gate("failed")])).toBe("failed");
  });

  it("prioritizes flagged over passed", () => {
    expect(qualityGateStatus([gate("passed"), gate("flagged")])).toBe("flagged");
  });

  it("returns passed when every gate passed", () => {
    expect(qualityGateStatus([gate("passed"), gate("passed")])).toBe("passed");
  });
});
