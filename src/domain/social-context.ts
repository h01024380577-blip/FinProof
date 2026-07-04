type SocialContextEvidenceLike = {
  documentId?: string;
  sourceFileId?: string;
  chunkId?: string;
  title?: string;
  quoteSummary?: string;
  sourceType?: string;
};

const SOCIAL_CONTEXT_DOCUMENT_PATTERNS = [
  /(?:^|\s)00\s*사회\s*맥락\s*리스크\s*총칙/,
  /(?:^|\s)01\s*민감\s*날짜\s*기념일/,
  /(?:^|\s)02\s*상징\s*이미지/,
  /(?:^|\s)03\s*문구\s*캠페인명/,
  /(?:^|\s)04\s*타겟\s*고객\s*취약\s*계층/,
  /(?:^|\s)05\s*소비자\s*정서\s*금융\s*불안/,
  /(?:^|\s)06\s*과거\s*논란\s*사례\s*패턴/,
  /사회\s*맥락/,
  /사회\s*이슈/,
  /월간\s*이슈/,
  /긴급.*(?:사회\s*이슈|항공\s*참사|지역\s*재난)/,
  /항공\s*참사/,
  /지역\s*재난/
];

function normalized(value: string | undefined) {
  return (value ?? "")
    .normalize("NFC")
    .replace(/\.(md|markdown|pdf|txt|docx?)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function socialContextDocumentIdentity(candidate: SocialContextEvidenceLike) {
  return [candidate.title, candidate.documentId, candidate.sourceFileId, candidate.chunkId]
    .map(normalized)
    .filter(Boolean)
    .join(" ");
}

export function isSocialContextEvidence(candidate: SocialContextEvidenceLike): boolean {
  if (candidate.sourceType === "product_doc") {
    return false;
  }

  return matchesAny(socialContextDocumentIdentity(candidate), SOCIAL_CONTEXT_DOCUMENT_PATTERNS);
}
