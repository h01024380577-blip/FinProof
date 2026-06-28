"use client";

import { useMemo, useState, type JSX } from "react";
import {
  toSideBySideRows,
  type DiffLine,
  type DocumentDiff,
  type RevisionDiff
} from "@/domain/revision-diff";

export type RevisionDiffViewProps = {
  diff: RevisionDiff;
};

const STATUS_LABEL: Record<DocumentDiff["status"], string> = {
  modified: "변경됨",
  added: "신규",
  removed: "삭제됨",
  unchanged: "동일"
};

function documentOptionLabel(document: DocumentDiff): string {
  const name = document.currentFileName ?? document.previousFileName ?? "문서";
  return `${name} — ${STATUS_LABEL[document.status]}`;
}

function lineClass(line: DiffLine | undefined): string {
  if (!line) {
    return "revision-diff__line revision-diff__line--empty";
  }
  if (line.kind === "added") {
    return "revision-diff__line revision-diff__line--add";
  }
  if (line.kind === "removed") {
    return "revision-diff__line revision-diff__line--del";
  }
  return "revision-diff__line revision-diff__line--ctx";
}

function lineNumber(line: DiffLine | undefined, side: "old" | "new"): string {
  if (!line) {
    return "";
  }
  const value = side === "old" ? line.oldLine : line.newLine;
  return value ? String(value) : "";
}

export function RevisionDiffView({ diff }: RevisionDiffViewProps): JSX.Element {
  const defaultIndex = useMemo(() => {
    const changed = diff.documents.findIndex((document) => document.status !== "unchanged");
    return changed === -1 ? 0 : changed;
  }, [diff.documents]);
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);

  const document = diff.documents[selectedIndex] ?? diff.documents[0];
  const rows = useMemo(
    () => (document ? toSideBySideRows(document.lines) : []),
    [document]
  );

  if (!document) {
    return (
      <div className="revision-diff revision-diff--empty">
        <p>비교할 문서가 없습니다.</p>
      </div>
    );
  }

  return (
    <section className="revision-diff" aria-label="버전 변경 비교">
      <header className="revision-diff__head">
        <div className="revision-diff__doc-select">
          <label htmlFor="revision-diff-doc">문서</label>
          <select
            id="revision-diff-doc"
            value={selectedIndex}
            onChange={(event) => setSelectedIndex(Number(event.target.value))}
          >
            {diff.documents.map((doc, index) => (
              <option key={doc.currentFileName ?? doc.previousFileName ?? index} value={index}>
                {documentOptionLabel(doc)}
              </option>
            ))}
          </select>
        </div>
        <span
          className={`revision-diff__badge revision-diff__badge--${document.status}`}
        >
          {STATUS_LABEL[document.status]}
        </span>
        {document.status !== "unchanged" ? (
          <span className="revision-diff__counts">
            <span className="revision-diff__counts-add">+{document.addedCount}</span>
            {" / "}
            <span className="revision-diff__counts-del">-{document.removedCount}</span>
          </span>
        ) : null}
      </header>

      <div className="revision-diff__split">
        <div className="revision-diff__col revision-diff__col--left">
          <div className="revision-diff__cap">이전 버전 v{diff.previousVersion}</div>
          <div className="revision-diff__lines">
            {rows.map((row, index) => (
              <div key={`l-${index}`} className={lineClass(row.left)}>
                <span className="revision-diff__gutter">{lineNumber(row.left, "old")}</span>
                <span className="revision-diff__code">{row.left?.text ?? ""}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="revision-diff__col revision-diff__col--right">
          <div className="revision-diff__cap">현재 버전 v{diff.currentVersion}</div>
          <div className="revision-diff__lines">
            {rows.map((row, index) => (
              <div key={`r-${index}`} className={lineClass(row.right)}>
                <span className="revision-diff__gutter">{lineNumber(row.right, "new")}</span>
                <span className="revision-diff__code">{row.right?.text ?? ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="revision-diff__note">
        OCR 추출 텍스트 기준 비교입니다. 이미지·바이너리 문서는 시각 차이가 아닌 추출 텍스트 변화만 표시됩니다.
      </p>
    </section>
  );
}
