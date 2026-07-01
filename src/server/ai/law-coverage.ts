import type { Evidence } from "@/domain/types";

const LAW_NAME_PATTERNS: RegExp[] = [
  /[가-힣]{2,}(?:\s+[가-힣]{2,})*\s*에\s*관한\s*법률/,
  /[가-힣A-Za-z0-9·]{2,}(?:\s[가-힣A-Za-z0-9·]{1,10})?법(?:률)?/
];

export function extractLawName(question: string): string | undefined {
  for (const pattern of LAW_NAME_PATTERNS) {
    const match = question.match(pattern);

    if (match) {
      return match[0].trim();
    }
  }

  return undefined;
}

// Prose (issue title/description) tends to embed the statute name mid-sentence,
// so we prefer a contiguous law token and avoid capturing preceding connective
// words the way the question patterns intentionally do for spaced short names.
const ISSUE_LAW_NAME_PATTERNS: RegExp[] = [
  /[가-힣]{2,}(?:\s+[가-힣]{2,})*\s*에\s*관한\s*법률/,
  /[가-힣]{2,20}법(?:률)?/
];

function extractLawNameFromText(text: string): string | undefined {
  for (const pattern of ISSUE_LAW_NAME_PATTERNS) {
    const match = text.match(pattern);

    if (match) {
      return match[0].trim();
    }
  }

  return undefined;
}

/**
 * Falls back to the issue text when the question itself only mentions "법령"
 * generically (e.g. "예금자 보호문구 관련 법령 찾아줘"). Scans the issue title,
 * description, and target text for a recognizable law name so the live law
 * lookup can still run.
 */
export function extractLawNameFromIssue(issue: {
  title?: string;
  description?: string;
  targetText?: string;
}): string | undefined {
  for (const text of [issue.title, issue.description, issue.targetText]) {
    if (!text) {
      continue;
    }

    const found = extractLawNameFromText(text);

    if (found) {
      return found;
    }
  }

  return undefined;
}

export function assessLawCoverage(
  evidence: Evidence[],
  question: string,
  minScore: number
): boolean {
  const authoritative = evidence.filter(
    (item) =>
      (item.sourceType === "law" || item.sourceType === "internal_policy") &&
      item.relevanceScore >= minScore
  );

  if (authoritative.length === 0) {
    return false;
  }

  const lawName = extractLawName(question);

  if (!lawName) {
    return true;
  }

  const normalized = lawName.replace(/\s+/g, "");

  return authoritative.some((item) => item.title.replace(/\s+/g, "").includes(normalized));
}
