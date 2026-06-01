import type { EvidenceChunk, KnowledgeDocument } from "./types";
import {
  appliesToEffectiveDate,
  isActiveEvidenceChunk,
  isActiveKnowledgeDocument,
  regulatorySourceStatusLabel
} from "./regulatory";

describe("regulatory domain helpers", () => {
  it("recognizes active knowledge and active chunks", () => {
    const document = {
      lifecycleStatus: "active",
      approvalStatus: "approved"
    } as KnowledgeDocument;
    const documentWithoutLifecycle = {
      approvalStatus: "approved"
    } as KnowledgeDocument;
    const chunk = {
      chunkStatus: "active"
    } as EvidenceChunk;
    const chunkWithoutStatus = {} as EvidenceChunk;

    expect(isActiveKnowledgeDocument(document)).toBe(true);
    expect(isActiveKnowledgeDocument(documentWithoutLifecycle)).toBe(true);
    expect(isActiveEvidenceChunk(chunk)).toBe(true);
    expect(isActiveEvidenceChunk(chunkWithoutStatus)).toBe(true);
  });

  it("checks applicability against planned publish dates", () => {
    expect(
      appliesToEffectiveDate(
        { effectiveFrom: "2026-07-01", effectiveTo: "2026-12-31" },
        "2026-12-31T23:59:59+09:00"
      )
    ).toBe(true);
    expect(
      appliesToEffectiveDate(
        { effectiveFrom: "2026-07-01", effectiveTo: "2026-12-31" },
        "2026-06-30"
      )
    ).toBe(false);
    expect(
      appliesToEffectiveDate(
        { effectiveFrom: "2026-07-01", effectiveTo: "2026-12-31" },
        "2027-01-01"
      )
    ).toBe(false);
  });

  it("labels source health in Korean for the dashboard", () => {
    expect(regulatorySourceStatusLabel("active")).toBe("정상");
    expect(regulatorySourceStatusLabel("failing")).toBe("수집 실패");
    expect(regulatorySourceStatusLabel("paused")).toBe("중지");
  });
});
