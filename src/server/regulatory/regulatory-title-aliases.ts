export type TitleResolution =
  | { kind: "excerpt" } // 큐레이션 발췌본 — 폴러 추적 제외
  | { kind: "alias"; officialTitle: string } // 정식명으로 치환해 검색/대조
  | { kind: "passthrough" }; // 문서 제목 그대로 사용

// 정식 법령명이 아닌 등록 제목 → law.go.kr 정식명 매핑.
// (약칭/원문표기 등. 발췌본은 아래 heuristic으로 별도 처리)
const OFFICIAL_TITLE_ALIASES: Record<string, string> = {
  "여신전문금융업법 (원문)": "여신전문금융업법"
};

/**
 * 등록 지식문서 제목을 폴러가 어떻게 다뤄야 하는지 판별한다.
 * - alias: 정식명으로 검색·정확명 대조.
 * - excerpt: FinProof가 광고 조항만 뽑은 발췌본("정식명 — 용도" 제목 관행). 전문과
 *   대조하면 항상 "변경"으로 뜨므로 추적 대상에서 제외한다.
 * - passthrough: 그 외(정식명으로 간주).
 */
export function resolveTrackingTitle(documentTitle: string): TitleResolution {
  const title = documentTitle.trim();

  const alias = OFFICIAL_TITLE_ALIASES[title];
  if (alias) {
    return { kind: "alias", officialTitle: alias };
  }

  // "정식명 — 용도" / "정식명 – 용도" (공백 + 대시 + 공백) = 큐레이션 발췌본.
  if (/\s[—–]\s/.test(title)) {
    return { kind: "excerpt" };
  }

  return { kind: "passthrough" };
}
