import {
  buildRevisionDiff,
  diffLines,
  matchDocuments,
  splitLines,
  toSideBySideRows,
  type ReviewDocumentExtraction
} from "./revision-diff";

function doc(
  partial: Partial<ReviewDocumentExtraction> & Pick<ReviewDocumentExtraction, "fileName" | "text">
): ReviewDocumentExtraction {
  return {
    fileId: partial.fileId ?? partial.fileName,
    fileType: partial.fileType ?? "product_description",
    fileName: partial.fileName,
    text: partial.text
  };
}

describe("splitLines", () => {
  it("normalizes CRLF and trims trailing blank lines and right whitespace", () => {
    expect(splitLines("a  \r\nb\n\n\n")).toEqual(["a", "b"]);
  });
});

describe("diffLines (LCS)", () => {
  it("marks identical text as all context", () => {
    const lines = diffLines("one\ntwo", "one\ntwo");
    expect(lines.every((line) => line.kind === "context")).toBe(true);
    expect(lines.map((line) => line.text)).toEqual(["one", "two"]);
  });

  it("detects a removed line", () => {
    const lines = diffLines("keep\ndrop me\ntail", "keep\ntail");
    expect(lines).toEqual([
      { kind: "context", text: "keep", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "drop me", oldLine: 2 },
      { kind: "context", text: "tail", oldLine: 3, newLine: 2 }
    ]);
  });

  it("detects an added line", () => {
    const lines = diffLines("keep\ntail", "keep\nbrand new\ntail");
    expect(lines).toEqual([
      { kind: "context", text: "keep", oldLine: 1, newLine: 1 },
      { kind: "added", text: "brand new", newLine: 2 },
      { kind: "context", text: "tail", oldLine: 2, newLine: 3 }
    ]);
  });

  it("represents a modified line as removed + added pair", () => {
    const lines = diffLines("연 5.0% 특별금리\n원금 보장", "연 5.0% 특별금리\n원금 비보장");
    expect(lines).toEqual([
      { kind: "context", text: "연 5.0% 특별금리", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "원금 보장", oldLine: 2 },
      { kind: "added", text: "원금 비보장", newLine: 2 }
    ]);
  });
});

describe("matchDocuments", () => {
  it("pairs by exact filename first", () => {
    const pairs = matchDocuments(
      [doc({ fileName: "a.pdf", text: "x" }), doc({ fileName: "b.pdf", text: "y" })],
      [doc({ fileName: "b.pdf", text: "y2" }), doc({ fileName: "a.pdf", text: "x2" })]
    );
    const byCurrent = pairs.map((pair) => [pair.previous?.fileName, pair.current?.fileName]);
    expect(byCurrent).toEqual([
      ["b.pdf", "b.pdf"],
      ["a.pdf", "a.pdf"]
    ]);
  });

  it("falls back to fileType + order when filename changed", () => {
    const pairs = matchDocuments(
      [doc({ fileName: "old.pdf", fileType: "rate_table", text: "1" })],
      [doc({ fileName: "new.pdf", fileType: "rate_table", text: "2" })]
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].previous?.fileName).toBe("old.pdf");
    expect(pairs[0].current?.fileName).toBe("new.pdf");
  });

  it("reports unmatched current as added and unmatched previous as removed", () => {
    const pairs = matchDocuments(
      [doc({ fileName: "gone.pdf", fileType: "terms", text: "1" })],
      [doc({ fileName: "fresh.xlsx", fileType: "rate_table", text: "2" })]
    );
    const added = pairs.find((pair) => !pair.previous && pair.current);
    const removed = pairs.find((pair) => pair.previous && !pair.current);
    expect(added?.current?.fileName).toBe("fresh.xlsx");
    expect(removed?.previous?.fileName).toBe("gone.pdf");
  });
});

describe("toSideBySideRows", () => {
  it("aligns context on both sides and pairs modified removed/added rows", () => {
    const rows = toSideBySideRows(diffLines("keep\nold line\ntail", "keep\nnew line\ntail"));
    expect(rows).toEqual([
      { left: { kind: "context", text: "keep", oldLine: 1, newLine: 1 }, right: { kind: "context", text: "keep", oldLine: 1, newLine: 1 } },
      { left: { kind: "removed", text: "old line", oldLine: 2 }, right: { kind: "added", text: "new line", newLine: 2 } },
      { left: { kind: "context", text: "tail", oldLine: 3, newLine: 3 }, right: { kind: "context", text: "tail", oldLine: 3, newLine: 3 } }
    ]);
  });

  it("leaves the opposite side empty for pure add/remove", () => {
    const rows = toSideBySideRows(diffLines("a", "a\nb"));
    expect(rows[1]).toEqual({ left: undefined, right: { kind: "added", text: "b", newLine: 2 } });
  });
});

describe("buildRevisionDiff", () => {
  it("classifies modified / added / removed / unchanged documents", () => {
    const diff = buildRevisionDiff(
      [
        doc({ fileName: "설명서.pdf", fileType: "product_description", text: "A\nB" }),
        doc({ fileName: "약관.pdf", fileType: "terms", text: "same" }),
        doc({ fileName: "삭제.pdf", fileType: "misc", text: "gone" })
      ],
      [
        doc({ fileName: "설명서.pdf", fileType: "product_description", text: "A\nC" }),
        doc({ fileName: "약관.pdf", fileType: "terms", text: "same" }),
        doc({ fileName: "금리표.xlsx", fileType: "rate_table", text: "new" })
      ],
      1,
      2
    );

    expect(diff.previousVersion).toBe(1);
    expect(diff.currentVersion).toBe(2);

    const byName = (name: string) =>
      diff.documents.find(
        (document) => document.currentFileName === name || document.previousFileName === name
      );

    expect(byName("설명서.pdf")?.status).toBe("modified");
    expect(byName("설명서.pdf")).toMatchObject({ addedCount: 1, removedCount: 1 });
    expect(byName("약관.pdf")?.status).toBe("unchanged");
    expect(byName("금리표.xlsx")?.status).toBe("added");
    expect(byName("삭제.pdf")?.status).toBe("removed");
  });
});
