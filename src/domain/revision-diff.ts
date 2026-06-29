import type { ReviewFile } from "./types";

/**
 * 반려 후 재업로드된 수정본(현재 버전)을 직전 버전과 비교하기 위한, 외부 의존성 없는
 * 결정적(LCS 기반) 텍스트 diff. 프로젝트의 deterministic 분석 철학과 동일하게 입력이 같으면
 * 항상 같은 결과를 낸다.
 */

export type ReviewDocumentExtraction = {
  fileId: string;
  fileName: string;
  fileType: ReviewFile["fileType"];
  text: string;
};

export type DiffLineKind = "context" | "added" | "removed";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  /** 해당 라인의 원본(1-base) 번호. context는 양쪽 모두, added는 new만, removed는 old만 가진다. */
  oldLine?: number;
  newLine?: number;
};

export type DocumentDiffStatus = "added" | "removed" | "modified" | "unchanged";

export type DocumentDiff = {
  fileType: ReviewFile["fileType"];
  previousFileName?: string;
  currentFileName?: string;
  status: DocumentDiffStatus;
  addedCount: number;
  removedCount: number;
  lines: DiffLine[];
};

export type RevisionDiff = {
  previousVersion: number;
  currentVersion: number;
  documents: DocumentDiff[];
};

/** OCR 추출 텍스트를 라인 배열로 정규화한다(개행 통일, 우측 공백 제거, 끝의 빈 줄 제거). */
export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * 두 라인 배열의 최장공통부분수열(LCS) 길이 테이블을 만들고, 역추적으로
 * removed(old만) / added(new만) / context(공통) 라인을 순서대로 생성한다.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const rows = oldLines.length;
  const cols = newLines.length;

  // lcs[i][j] = oldLines[i..]와 newLines[j..]의 LCS 길이
  const lcs: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0)
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (oldLines[i] === newLines[j]) {
      result.push({ kind: "context", text: oldLines[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ kind: "removed", text: oldLines[i], oldLine: i + 1 });
      i += 1;
    } else {
      result.push({ kind: "added", text: newLines[j], newLine: j + 1 });
      j += 1;
    }
  }
  while (i < rows) {
    result.push({ kind: "removed", text: oldLines[i], oldLine: i + 1 });
    i += 1;
  }
  while (j < cols) {
    result.push({ kind: "added", text: newLines[j], newLine: j + 1 });
    j += 1;
  }
  return result;
}

/**
 * 이전/현재 버전의 문서를 짝짓는다.
 * ① 동일 파일명 → ② 동일 fileType + 등장 순서 → ③ 남은 것은 removed/added 단독.
 */
export type DocumentPair = {
  previous?: ReviewDocumentExtraction;
  current?: ReviewDocumentExtraction;
};

export function matchDocuments(
  previous: ReviewDocumentExtraction[],
  current: ReviewDocumentExtraction[]
): DocumentPair[] {
  const remainingPrev = previous.map((doc, index) => ({ doc, index }));
  const usedPrev = new Set<number>();
  const pairs: DocumentPair[] = [];
  // 현재 문서를 매칭 키 순서로 처리하되, 결과는 현재 순서를 보존한다.
  const pairedCurrentIndexes = new Set<number>();

  // ① 파일명 정확 일치
  current.forEach((cur, curIndex) => {
    const match = remainingPrev.find(
      (entry) => !usedPrev.has(entry.index) && entry.doc.fileName === cur.fileName
    );
    if (match) {
      usedPrev.add(match.index);
      pairedCurrentIndexes.add(curIndex);
      pairs.push({ previous: match.doc, current: cur });
    }
  });

  // ② fileType 일치(순서대로) — 아직 짝 못 찾은 현재 문서
  current.forEach((cur, curIndex) => {
    if (pairedCurrentIndexes.has(curIndex)) {
      return;
    }
    const match = remainingPrev.find(
      (entry) => !usedPrev.has(entry.index) && entry.doc.fileType === cur.fileType
    );
    if (match) {
      usedPrev.add(match.index);
      pairedCurrentIndexes.add(curIndex);
      pairs.push({ previous: match.doc, current: cur });
    }
  });

  // ③ 남은 현재 문서 = 신규(added)
  current.forEach((cur, curIndex) => {
    if (!pairedCurrentIndexes.has(curIndex)) {
      pairs.push({ current: cur });
    }
  });

  // ③ 남은 이전 문서 = 삭제(removed)
  remainingPrev.forEach((entry) => {
    if (!usedPrev.has(entry.index)) {
      pairs.push({ previous: entry.doc });
    }
  });

  return pairs;
}

/** 한 쌍(이전/현재)을 DocumentDiff로 변환. */
export function buildDocumentDiff(pair: DocumentPair): DocumentDiff {
  const { previous, current } = pair;
  const fileType = current?.fileType ?? previous?.fileType ?? "misc";

  if (previous && !current) {
    const lines = diffLines(previous.text, "");
    return {
      fileType,
      previousFileName: previous.fileName,
      status: "removed",
      addedCount: 0,
      removedCount: lines.filter((line) => line.kind === "removed").length,
      lines
    };
  }

  if (current && !previous) {
    const lines = diffLines("", current.text);
    return {
      fileType,
      currentFileName: current.fileName,
      status: "added",
      addedCount: lines.filter((line) => line.kind === "added").length,
      removedCount: 0,
      lines
    };
  }

  const lines = diffLines(previous?.text ?? "", current?.text ?? "");
  const addedCount = lines.filter((line) => line.kind === "added").length;
  const removedCount = lines.filter((line) => line.kind === "removed").length;
  return {
    fileType,
    previousFileName: previous?.fileName,
    currentFileName: current?.fileName,
    status: addedCount === 0 && removedCount === 0 ? "unchanged" : "modified",
    addedCount,
    removedCount,
    lines
  };
}

export type SideBySideRow = {
  left?: DiffLine;
  right?: DiffLine;
};

/**
 * 단일 시퀀스(context/removed/added)를 좌(이전)·우(현재) 분할 렌더용 행으로 변환한다.
 * 연속된 removed/added 묶음을 같은 행에 짝지어(수정 라인 정렬) 표시하고, context는 양쪽 동일 행.
 */
export function toSideBySideRows(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let pendingRemoved: DiffLine[] = [];
  let pendingAdded: DiffLine[] = [];

  const flush = (): void => {
    const max = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let index = 0; index < max; index += 1) {
      rows.push({ left: pendingRemoved[index], right: pendingAdded[index] });
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const line of lines) {
    if (line.kind === "removed") {
      pendingRemoved.push(line);
    } else if (line.kind === "added") {
      pendingAdded.push(line);
    } else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

/** 좌·우가 모두 context(동일)인 행 = 변경 없는 줄. */
function isUnchangedRow(row: SideBySideRow): boolean {
  return (
    row.left?.kind === "context" &&
    row.right?.kind === "context" &&
    row.left.text === row.right.text
  );
}

export type SideBySideEntry =
  | { type: "row"; row: SideBySideRow }
  | { type: "gap"; count: number };

/**
 * 변경된 부분만 보이도록, 변경 라인에서 `context`줄 이상 떨어진 동일 구간을 접는다.
 * 접힌 구간은 생략된 줄 수를 가진 gap 엔트리로 대체된다. 변경이 전혀 없으면 빈 배열을 반환한다.
 */
export function collapseSideBySide(rows: SideBySideRow[], context = 3): SideBySideEntry[] {
  const changed = rows.map((row) => !isUnchangedRow(row));
  if (!changed.some(Boolean)) {
    return [];
  }
  // 각 변경 라인 주변 context줄을 '표시' 대상으로 마크.
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((_, index) => {
    if (!changed[index]) {
      return;
    }
    for (let offset = -context; offset <= context; offset += 1) {
      const target = index + offset;
      if (target >= 0 && target < rows.length) {
        keep[target] = true;
      }
    }
  });

  const entries: SideBySideEntry[] = [];
  let gap = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (gap > 0) {
        entries.push({ type: "gap", count: gap });
        gap = 0;
      }
      entries.push({ type: "row", row });
    } else {
      gap += 1;
    }
  });
  if (gap > 0) {
    entries.push({ type: "gap", count: gap });
  }
  return entries;
}

/** 직전 버전 문서들과 현재 버전 문서들로 전체 RevisionDiff를 만든다. */
export function buildRevisionDiff(
  previousDocuments: ReviewDocumentExtraction[],
  currentDocuments: ReviewDocumentExtraction[],
  previousVersion: number,
  currentVersion: number
): RevisionDiff {
  const documents = matchDocuments(previousDocuments, currentDocuments).map(buildDocumentDiff);
  return { previousVersion, currentVersion, documents };
}
