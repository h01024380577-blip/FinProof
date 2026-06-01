import type { RegulatoryChangeType, RegulatoryChangedSection } from "@/domain/types";
import type { NormalizedRegulatorySection } from "./normalizer";

export type DetectedRegulatoryChange = {
  changeType: RegulatoryChangeType;
  changedSections: RegulatoryChangedSection[];
};

type DetectInput = {
  previousSnapshotId?: string;
  newSnapshotId: string;
  previous: NormalizedRegulatorySection[];
  next: NormalizedRegulatorySection[];
};

function sectionKey(section: NormalizedRegulatorySection): string {
  return section.sectionNumber ?? section.title;
}

function diffSummary(previousText: string | undefined, newText: string | undefined): string {
  if (!previousText && newText) {
    return "신설 조항입니다.";
  }

  if (previousText && !newText) {
    return "삭제된 조항입니다.";
  }

  return "기존 조항의 문구 또는 적용 범위가 변경되었습니다.";
}

function changedSection(
  section: NormalizedRegulatorySection,
  previousText: string | undefined,
  newText: string | undefined
): RegulatoryChangedSection {
  return {
    sectionId: section.id,
    sectionNumber: section.sectionNumber,
    title: section.title,
    previousText,
    newText,
    diffSummary: diffSummary(previousText, newText),
    citation: section.citation
  };
}

export function detectRegulatoryChanges(input: DetectInput): DetectedRegulatoryChange[] {
  const previousByKey = new Map(input.previous.map((section) => [sectionKey(section), section]));
  const nextByKey = new Map(input.next.map((section) => [sectionKey(section), section]));
  const changes: DetectedRegulatoryChange[] = [];

  for (const nextSection of input.next) {
    const previousSection = previousByKey.get(sectionKey(nextSection));

    if (!previousSection) {
      changes.push({
        changeType: "created",
        changedSections: [changedSection(nextSection, undefined, nextSection.text)]
      });
      continue;
    }

    if (previousSection.text !== nextSection.text || previousSection.title !== nextSection.title) {
      changes.push({
        changeType: "amended",
        changedSections: [changedSection(nextSection, previousSection.text, nextSection.text)]
      });
    }
  }

  for (const previousSection of input.previous) {
    if (!nextByKey.has(sectionKey(previousSection))) {
      changes.push({
        changeType: "deleted",
        changedSections: [changedSection(previousSection, previousSection.text, undefined)]
      });
    }
  }

  return changes;
}
