import { detectRegulatoryChanges } from "./change-diff";
import type { NormalizedRegulatorySection } from "./normalizer";

function section(
  snapshotId: string,
  id: string,
  title: string,
  text: string,
  sectionNumber?: string
): NormalizedRegulatorySection {
  return {
    id,
    snapshotId,
    title,
    text,
    sectionNumber,
    citation: { snapshotId, sectionId: id }
  };
}

describe("detectRegulatoryChanges", () => {
  it("detects amended and created sections", () => {
    const previous = [
      section("snapshot-old", "section-001", "최고금리 표시", "최고금리 표현 시 우대조건을 표시해야 한다.", "제2조")
    ];
    const next = [
      section(
        "snapshot-new",
        "section-001",
        "최고금리 표시",
        "최고금리 표현 시 기본금리, 우대조건, 적용 한도를 인접 영역에 표시해야 한다.",
        "제2조"
      ),
      section("snapshot-new", "section-002", "모바일 배너", "모바일 배너는 핵심 제한 조건을 같은 화면에 표시해야 한다.", "제3조")
    ];

    const changes = detectRegulatoryChanges({
      previousSnapshotId: "snapshot-old",
      newSnapshotId: "snapshot-new",
      previous,
      next
    });

    expect(changes).toEqual([
      expect.objectContaining({
        changeType: "amended",
        changedSections: [
          expect.objectContaining({
            title: "최고금리 표시",
            previousText: "최고금리 표현 시 우대조건을 표시해야 한다.",
            newText: "최고금리 표현 시 기본금리, 우대조건, 적용 한도를 인접 영역에 표시해야 한다."
          })
        ]
      }),
      expect.objectContaining({
        changeType: "created",
        changedSections: [
          expect.objectContaining({
            title: "모바일 배너",
            previousText: undefined,
            newText: "모바일 배너는 핵심 제한 조건을 같은 화면에 표시해야 한다."
          })
        ]
      })
    ]);
  });

  it("detects deleted sections", () => {
    const previous = [
      section("snapshot-old", "section-001", "모바일 배너", "모바일 배너는 핵심 제한 조건을 같은 화면에 표시해야 한다.", "제3조")
    ];

    const changes = detectRegulatoryChanges({
      previousSnapshotId: "snapshot-old",
      newSnapshotId: "snapshot-new",
      previous,
      next: []
    });

    expect(changes).toEqual([
      expect.objectContaining({
        changeType: "deleted",
        changedSections: [
          expect.objectContaining({
            title: "모바일 배너",
            previousText: "모바일 배너는 핵심 제한 조건을 같은 화면에 표시해야 한다.",
            newText: undefined,
            diffSummary: "삭제된 조항입니다.",
            citation: { snapshotId: "snapshot-old", sectionId: "section-001" }
          })
        ]
      })
    ]);
  });
});
