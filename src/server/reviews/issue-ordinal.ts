import type { ReviewIssue, RiskLevel } from "@/domain/types";

// Mirror the workbench IssueList numbering: issues are shown risk-severity
// descending (위험 → 주의 → 참고), and Array.prototype.sort is stable so
// same-risk issues keep their original order. The reviewer's "N번" therefore
// refers to this ordering, not the raw review.issues array order.
const riskRank: Record<RiskLevel, number> = { high: 0, caution: 1, info: 2 };

export function sortIssuesByRisk(issues: ReviewIssue[]): ReviewIssue[] {
  return [...issues].sort((a, b) => riskRank[a.riskLevel] - riskRank[b.riskLevel]);
}

const koreanOrdinalWords: Record<string, number> = {
  첫: 1,
  둘: 2,
  두: 2,
  셋: 3,
  세: 3,
  넷: 4,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10
};

/**
 * Extracts a 1-based issue ordinal from a Korean reviewer question. Recognises
 * "1번", "2번째", "3 번", "이슈 4", and Korean ordinal words like "첫 번째",
 * "두번째", "셋째". Returns undefined when no ordinal reference is present.
 */
export function parseIssueOrdinal(question: string): number | undefined {
  // Korean ordinal word + 번째/째 (e.g. "첫 번째", "두번째", "셋째")
  const wordMatch = question.match(
    /(첫|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉|열)\s*(?:번째|째)/
  );
  if (wordMatch && koreanOrdinalWords[wordMatch[1]!] !== undefined) {
    return koreanOrdinalWords[wordMatch[1]!];
  }

  // Digit + 번 / 번째 (e.g. "1번", "2번째", "3 번")
  const digitBeon = question.match(/(\d+)\s*번(?:째)?/);
  if (digitBeon) {
    const value = Number(digitBeon[1]);
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
  }

  // 이슈 + digit (e.g. "이슈 4")
  const issueDigit = question.match(/이슈\s*(\d+)/);
  if (issueDigit) {
    const value = Number(issueDigit[1]);
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
  }

  return undefined;
}

export type ResolvedChatIssue = {
  issue: ReviewIssue;
  /** 1-based number as the reviewer sees it in the risk-sorted issue list. */
  number: number;
  /** True when the target issue was switched because the question named a number. */
  reselectedByOrdinal: boolean;
};

/**
 * Resolves which issue a chat question is really about. When the question names
 * an issue number (e.g. "1번 이슈 설명해줘") and that number is in range, the
 * target issue is switched to the matching risk-sorted issue so downstream
 * retrieval and the model answer about the right one. Otherwise the pre-selected
 * issue is kept.
 */
export function resolveChatIssueByOrdinal(
  issues: ReviewIssue[],
  question: string,
  selectedIssue: ReviewIssue
): ResolvedChatIssue {
  const ordered = sortIssuesByRisk(issues);
  const selectedNumber = ordered.findIndex((issue) => issue.id === selectedIssue.id) + 1;
  const ordinal = parseIssueOrdinal(question);

  if (ordinal && ordinal >= 1 && ordinal <= ordered.length) {
    const target = ordered[ordinal - 1]!;
    return {
      issue: target,
      number: ordinal,
      reselectedByOrdinal: target.id !== selectedIssue.id
    };
  }

  return {
    issue: selectedIssue,
    number: selectedNumber > 0 ? selectedNumber : 1,
    reselectedByOrdinal: false
  };
}
