"use client";

import { useMemo, useState, type JSX } from "react";
import {
  collapseSideBySide,
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

/** 압축 경로(zip/폴더/파일)에서 실제 파일명(마지막 경로 조각)만 뽑아 잘림을 줄인다. */
function baseFileName(name: string): string {
  const segments = name.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? name;
}

function documentOptionLabel(document: DocumentDiff): string {
  const name = document.currentFileName ?? document.previousFileName ?? "문서";
  return `${baseFileName(name)} — ${STATUS_LABEL[document.status]}`;
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
  // 변경된 부분만 보이도록 동일 구간을 접는다(변경 라인 ±3줄만 컨텍스트로 유지).
  const entries = useMemo(
    () => (document ? collapseSideBySide(toSideBySideRows(document.lines)) : []),
    [document]
  );
  const hasChanges = entries.length > 0;

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

      {hasChanges ? (
        <div className="revision-diff__split">
          <div className="revision-diff__col revision-diff__col--left">
            <div className="revision-diff__cap">이전 버전 v{diff.previousVersion}</div>
            <div className="revision-diff__lines">
              {entries.map((entry, index) =>
                entry.type === "gap" ? (
                  <div key={`l-${index}`} className="revision-diff__gap" aria-hidden="true">
                    <span className="revision-diff__gutter" />
                    <span className="revision-diff__code">⋯ 동일 {entry.count}줄 생략</span>
                  </div>
                ) : (
                  <div key={`l-${index}`} className={lineClass(entry.row.left)}>
                    <span className="revision-diff__gutter">
                      {lineNumber(entry.row.left, "old")}
                    </span>
                    <span className="revision-diff__code">{entry.row.left?.text ?? ""}</span>
                  </div>
                )
              )}
            </div>
          </div>
          <div className="revision-diff__col revision-diff__col--right">
            <div className="revision-diff__cap">현재 버전 v{diff.currentVersion}</div>
            <div className="revision-diff__lines">
              {entries.map((entry, index) =>
                entry.type === "gap" ? (
                  <div key={`r-${index}`} className="revision-diff__gap" aria-hidden="true">
                    <span className="revision-diff__gutter" />
                    <span className="revision-diff__code">⋯ 동일 {entry.count}줄 생략</span>
                  </div>
                ) : (
                  <div key={`r-${index}`} className={lineClass(entry.row.right)}>
                    <span className="revision-diff__gutter">
                      {lineNumber(entry.row.right, "new")}
                    </span>
                    <span className="revision-diff__code">{entry.row.right?.text ?? ""}</span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="revision-diff__unchanged" role="status">
          <strong>변경된 부분이 없습니다.</strong>
          <span>이전 버전 v{diff.previousVersion}과(와) 추출 텍스트가 동일합니다.</span>
        </div>
      )}

      <p className="revision-diff__note">
        변경된 부분만 표시합니다. OCR 추출 텍스트 기준 비교이며, 이미지·바이너리 문서는 시각 차이가 아닌
        추출 텍스트 변화만 반영됩니다.
      </p>
    </section>
  );
}
