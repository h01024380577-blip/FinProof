import { render, screen, within } from "@testing-library/react";
import type { QualityGateResult, RegulatoryChangeSet } from "@/domain/types";
import { RegulatoryChangeSetDetail } from "./RegulatoryChangeSetDetail";

describe("RegulatoryChangeSetDetail", () => {
  it("shows changed section text and quality gate results", () => {
    const changeSet: RegulatoryChangeSet = {
      id: "reg-change-001",
      tenantId: "tenant-demo",
      sourceId: "reg-source-001",
      newSnapshotId: "reg-snapshot-001",
      changeType: "amended",
      changeSummary: "최고금리 표시 기준이 개정되었습니다.",
      changedSections: [
        {
          sectionId: "section-001",
          sectionNumber: "제1조",
          title: "최고금리 표시",
          previousText: "이전 문구",
          newText: "변경 문구",
          diffSummary: "금리 조건 고지 위치가 강화되었습니다.",
          citation: { snapshotId: "reg-snapshot-001", sectionId: "section-001" }
        }
      ],
      effectiveFrom: "2026-07-01",
      riskImpactLevel: "high",
      interpretationSummary: "최고금리 표현 옆에 기본금리와 우대조건을 표시해야 합니다.",
      mappedProductTypes: ["deposit"],
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"],
      qualityGateStatus: "passed",
      confidence: 0.94,
      createdAt: "2026-05-31T00:00:00.000Z"
    };
    const qualityGateResults: QualityGateResult[] = [
      {
        id: "gate-reg-change-001-citation_coverage",
        changeSetId: changeSet.id,
        gateType: "citation_coverage",
        status: "passed",
        summary: "모든 변경 섹션에 원문 citation이 있습니다.",
        evidence: {},
        createdAt: "2026-05-31T00:00:00.000Z"
      }
    ];

    render(
      <RegulatoryChangeSetDetail
        changeSet={changeSet}
        qualityGateResults={qualityGateResults}
      />
    );

    expect(screen.getByText("이전 문구")).toBeInTheDocument();
    expect(screen.getByText("변경 문구")).toBeInTheDocument();
    expect(screen.getByText("Citation Coverage")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("passed")).toBeInTheDocument();
  });
});
