export type NormalizedRegulatorySection = {
  id: string;
  snapshotId: string;
  sectionNumber?: string;
  title: string;
  text: string;
  citation: {
    snapshotId: string;
    sectionId: string;
  };
};

type NormalizeInput = {
  snapshotId: string;
  text: string;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function headingParts(line: string): { sectionNumber?: string; title: string } | undefined {
  const koreanArticle = line.match(/^(제\d+조(?:의\d+)?)(?:\s+(.+)|\s*\((.+)\))$/);

  if (koreanArticle) {
    const title = normalizeWhitespace(koreanArticle[2] ?? koreanArticle[3]);

    if (title === "및" || title.startsWith("및 ")) {
      return undefined;
    }

    return {
      sectionNumber: koreanArticle[1],
      title
    };
  }

  const markdownHeading = line.match(/^#{1,4}\s+(.+)$/);

  if (markdownHeading) {
    return headingParts(markdownHeading[1]) ?? { title: normalizeWhitespace(markdownHeading[1]) };
  }

  return undefined;
}

export function normalizeRegulatoryText({ snapshotId, text }: NormalizeInput): NormalizedRegulatorySection[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sections: Array<{ sectionNumber?: string; title: string; body: string[] }> = [];

  for (const line of lines) {
    const heading = headingParts(line);

    if (heading) {
      sections.push({ ...heading, body: [] });
      continue;
    }

    if (sections.length === 0) {
      sections.push({ title: "본문", body: [] });
    }

    sections[sections.length - 1].body.push(line);
  }

  return sections
    .filter((section) => section.body.length > 0)
    .map((section, index) => {
      const id = `section-${String(index + 1).padStart(3, "0")}`;

      return {
        id,
        snapshotId,
        sectionNumber: section.sectionNumber,
        title: section.title,
        text: normalizeWhitespace(section.body.join(" ")),
        citation: { snapshotId, sectionId: id }
      };
    });
}
