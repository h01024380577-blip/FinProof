import { normalizeRegulatoryText } from "./normalizer";

describe("normalizeRegulatoryText", () => {
  it("turns regulatory text into stable sections", () => {
    const sections = normalizeRegulatoryText({
      snapshotId: "snapshot-new",
      text: [
        "제1조 목적",
        "이 기준은 금융광고 심의 기준을 정한다.",
        "",
        "제2조 최고금리 표시",
        "최고금리 표현 시 기본금리와 우대조건을 인접 영역에 표시해야 한다."
      ].join("\n")
    });

    expect(sections).toEqual([
      {
        id: "section-001",
        snapshotId: "snapshot-new",
        sectionNumber: "제1조",
        title: "목적",
        text: "이 기준은 금융광고 심의 기준을 정한다.",
        citation: { snapshotId: "snapshot-new", sectionId: "section-001" }
      },
      {
        id: "section-002",
        snapshotId: "snapshot-new",
        sectionNumber: "제2조",
        title: "최고금리 표시",
        text: "최고금리 표현 시 기본금리와 우대조건을 인접 영역에 표시해야 한다.",
        citation: { snapshotId: "snapshot-new", sectionId: "section-002" }
      }
    ]);
  });

  it("extracts Korean article numbers from markdown headings", () => {
    const sections = normalizeRegulatoryText({
      snapshotId: "snapshot-new",
      text: [
        "## 제2조 최고금리 표시",
        "최고금리 표현 시 기본금리와 우대조건을 인접 영역에 표시해야 한다."
      ].join("\n")
    });

    expect(sections).toEqual([
      {
        id: "section-001",
        snapshotId: "snapshot-new",
        sectionNumber: "제2조",
        title: "최고금리 표시",
        text: "최고금리 표현 시 기본금리와 우대조건을 인접 영역에 표시해야 한다.",
        citation: { snapshotId: "snapshot-new", sectionId: "section-001" }
      }
    ]);
  });

  it("extracts parenthesized Korean article titles", () => {
    const sections = normalizeRegulatoryText({
      snapshotId: "snapshot-new",
      text: ["제1조(목적)", "이 기준은 금융광고 심의 기준을 정한다."].join("\n")
    });

    expect(sections).toEqual([
      {
        id: "section-001",
        snapshotId: "snapshot-new",
        sectionNumber: "제1조",
        title: "목적",
        text: "이 기준은 금융광고 심의 기준을 정한다.",
        citation: { snapshotId: "snapshot-new", sectionId: "section-001" }
      }
    ]);
  });

  it("keeps Korean article cross-references in body text", () => {
    const sections = normalizeRegulatoryText({
      snapshotId: "snapshot-new",
      text: [
        "제1조 목적",
        "제2조에 따른 기준을 적용한다.",
        "제2조 및 제3조의 기준을 따른다."
      ].join("\n")
    });

    expect(sections).toEqual([
      {
        id: "section-001",
        snapshotId: "snapshot-new",
        sectionNumber: "제1조",
        title: "목적",
        text: "제2조에 따른 기준을 적용한다. 제2조 및 제3조의 기준을 따른다.",
        citation: { snapshotId: "snapshot-new", sectionId: "section-001" }
      }
    ]);
  });
});
