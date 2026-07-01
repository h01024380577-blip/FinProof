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
