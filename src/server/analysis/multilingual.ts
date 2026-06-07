import type { ReviewIssue, RiskLevel } from "@/domain/types";
import type { ExtractedDocument } from "./review-analysis-pipeline";

export type SupportedReviewLanguage = "en" | "vi" | "my" | "km";

export type MultilingualSegment = {
  id: string;
  language: SupportedReviewLanguage;
  originalText: string;
  normalizedText: string;
  sourceFileId?: string;
  page?: number;
  bbox?: [number, number, number, number];
  confidence: number;
};

export type LocalizedRiskFinding = {
  id: string;
  segmentId: string;
  language: SupportedReviewLanguage;
  originalText: string;
  literalTranslation: string;
  complianceMeaning: string;
  riskCategory: "expression_risk" | "compliance_risk" | "both";
  riskSignals: string[];
  riskLevelHint: RiskLevel;
  suggestedCopyOriginalLanguage: string;
  suggestedCopyKoreanMeaning: string;
  confidence: number;
};

export type KoreanComplianceMapping = {
  localizedFindingId: LocalizedRiskFinding["id"];
  issueType: string;
  koreanComplianceCategory: string;
  koreanComplianceReason: string;
  evidenceQuery: string;
  suggestedAction: ReviewIssue["suggestedAction"];
};

export type MultilingualAgentError = {
  agentType:
    | "english_translator_risk"
    | "vietnamese_translator_risk"
    | "myanmar_translator_risk"
    | "khmer_translator_risk"
    | "korean_compliance_mapping";
  language?: SupportedReviewLanguage;
  message: string;
};

const ENGLISH_FINANCIAL_AD_TERMS =
  /\b(approval|approved|guaranteed|guarantee|loan|rate|rates|fee|fees|screening|eligible|instant|lowest|hidden)\b/i;
const VIETNAMESE_FINANCIAL_AD_TERMS =
  /\b(phê\s*duyệt|khoản\s*vay|lãi\s*suất|miễn\s*phí|ưu\s*đãi|thẻ\s*tín\s*dụng|ngân\s*hàng|vay|phí)\b/i;
const ENGLISH_FINANCIAL_WORDS = new Set([
  "approval",
  "approved",
  "guaranteed",
  "guarantee",
  "loan",
  "rate",
  "rates",
  "fee",
  "fees",
  "screening",
  "eligible",
  "instant",
  "lowest",
  "hidden",
  "customer",
  "representative"
]);
const VIETNAMESE_FINANCIAL_WORDS = new Set([
  "phe",
  "duyet",
  "khoan",
  "vay",
  "lai",
  "suat",
  "phi",
  "mien",
  "uu",
  "dai",
  "the",
  "tin",
  "dung",
  "ngan",
  "hang",
  "tra",
  "gop"
]);
const VIETNAMESE_MARKER_PATTERN =
  /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/u;
const LATIN_LETTER_COUNT_PATTERN = /[A-Za-z]/g;
const REVIEW_PACKAGE_METADATA_PATTERN =
  /\b(?:FinProof|productType|fileType|SamplePackageSelector|promotional_creative|copy_draft|product_description|rate_table|package_archive|POST|ZIP|src\/|\.tsx|\.ts)\b/i;
const REVIEW_PACKAGE_METADATA_KOREAN_PATTERN =
  /(제출\s*조건|필수\s*자료|파일\s*분류|신규\s*심의\s*요청|업로드\s*정책|누락\s*차단|분류\s*매핑|기준으로|확인합니다)/;
const HANGUL_PATTERN = /[\uac00-\ud7af]/;
const LATIN_SPAN_PATTERN = /[\p{Script=Latin}\p{M}0-9０-９%％.．,，·'’/\-: ]+/gu;
const LATIN_WORD_PATTERN = /[\p{Script=Latin}\p{M}]+/gu;
const MYANMAR_CHAR_PATTERN = /[\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]/u;
const KHMER_CHAR_PATTERN = /[\u1780-\u17ff\u19e0-\u19ff]/u;
const MYANMAR_SPAN_PATTERN = /[\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff0-9၀-၉%％.．,၊။·\- ]+/gu;
const KHMER_SPAN_PATTERN = /[\u1780-\u17ff\u19e0-\u19ff0-9០-៩%％.．,។៕·\- ]+/gu;

type SegmentCounter = Record<SupportedReviewLanguage, number>;
type DetectedLanguageSpan = {
  language: SupportedReviewLanguage;
  text: string;
  index: number;
};

export function segmentMultilingualDocuments(
  documents: ExtractedDocument[]
): MultilingualSegment[] {
  const counters: SegmentCounter = {
    en: 0,
    vi: 0,
    my: 0,
    km: 0
  };
  const segments: MultilingualSegment[] = [];

  for (const document of documents) {
    for (const line of document.text.split(/\r?\n/)) {
      for (const draft of segmentDraftsForLine(line)) {
        counters[draft.language] += 1;
        segments.push({
          id: segmentId(draft.language, counters[draft.language]),
          language: draft.language,
          originalText: draft.originalText,
          normalizedText: draft.normalizedText,
          sourceFileId: document.fileId,
          confidence: segmentConfidence(draft.language, draft.normalizedText, document.confidence)
        });
      }
    }
  }

  return segments;
}

function segmentDraftsForLine(line: string) {
  const normalizedText = normalizeSegmentText(line);
  if (normalizedText.length === 0) {
    return [];
  }

  if (isReviewPackageMetadataLine(normalizedText)) {
    return [];
  }

  const spans = detectedLanguageSpans(normalizedText);
  const detectedLanguages = [...new Set(spans.map((span) => span.language))];

  if (detectedLanguages.length <= 1) {
    const language = detectSupportedLanguage(normalizedText);

    return language
      ? [
          {
            language,
            originalText: line.trim(),
            normalizedText
          }
        ]
      : [];
  }

  const languageOrder: SupportedReviewLanguage[] = [];
  const spanTextsByLanguage = new Map<SupportedReviewLanguage, string[]>();

  for (const span of spans) {
    const text = normalizeSegmentText(span.text);
    if (text.length === 0) {
      continue;
    }

    if (!spanTextsByLanguage.has(span.language)) {
      languageOrder.push(span.language);
      spanTextsByLanguage.set(span.language, []);
    }

    spanTextsByLanguage.get(span.language)?.push(text);
  }

  return languageOrder.map((language) => {
    const text = normalizeSegmentText((spanTextsByLanguage.get(language) ?? []).join(" "));

    return {
      language,
      originalText: text,
      normalizedText: text
    };
  });
}

function detectedLanguageSpans(text: string): DetectedLanguageSpan[] {
  return [
    ...detectedLatinSpans(text),
    ...detectedScriptSpans(text, MYANMAR_SPAN_PATTERN, MYANMAR_CHAR_PATTERN, "my"),
    ...detectedScriptSpans(text, KHMER_SPAN_PATTERN, KHMER_CHAR_PATTERN, "km")
  ].sort(
    (left, right) => left.index - right.index
  );
}

function detectedLatinSpans(text: string): DetectedLanguageSpan[] {
  return [...text.matchAll(LATIN_SPAN_PATTERN)].flatMap((match) =>
    detectedLatinLanguageSpans(trimBoundaryPunctuation(match[0]), match.index ?? 0)
  );
}

function detectedScriptSpans(
  text: string,
  pattern: RegExp,
  charPattern: RegExp,
  language: Extract<SupportedReviewLanguage, "my" | "km">
): DetectedLanguageSpan[] {
  return [...text.matchAll(pattern)]
    .map((match) => ({
      text: trimBoundaryPunctuation(match[0]),
      index: match.index ?? 0
    }))
    .filter((span) => span.text.length > 0 && charPattern.test(span.text))
    .map((span) => ({
      language,
      text: span.text,
      index: span.index
    }));
}

function detectedLatinLanguageSpans(text: string, offset: number): DetectedLanguageSpan[] {
  if (text.length === 0) {
    return [];
  }

  const detected: DetectedLanguageSpan[] = [];
  let currentLanguage: Extract<SupportedReviewLanguage, "en" | "vi"> | undefined;
  let currentStart: number | undefined;

  for (const match of text.matchAll(LATIN_WORD_PATTERN)) {
    const language = latinWordLanguage(match[0]);
    const wordIndex = match.index ?? 0;

    if (!language) {
      continue;
    }

    if (!currentLanguage) {
      currentLanguage = language;
      currentStart = wordIndex;
      continue;
    }

    if (language !== currentLanguage && currentStart !== undefined) {
      const spanText = trimBoundaryPunctuation(text.slice(currentStart, wordIndex));

      if (spanText.length > 0) {
        detected.push({
          language: currentLanguage,
          text: spanText,
          index: offset + currentStart
        });
      }

      currentLanguage = language;
      currentStart = wordIndex;
    }
  }

  if (currentLanguage && currentStart !== undefined) {
    const spanText = trimBoundaryPunctuation(text.slice(currentStart));

    if (spanText.length > 0) {
      detected.push({
        language: currentLanguage,
        text: spanText,
        index: offset + currentStart
      });
    }
  }

  if (detected.length > 0) {
    return detected;
  }

  const language = detectLatinSupportedLanguage(text);

  return language
    ? [
        {
          language,
          text,
          index: offset
        }
      ]
    : [];
}

function detectSupportedLanguage(text: string): SupportedReviewLanguage | undefined {
  const latinLanguage = detectLatinSupportedLanguage(text);
  if (latinLanguage) {
    return latinLanguage;
  }

  if (MYANMAR_CHAR_PATTERN.test(text)) {
    return "my";
  }

  if (KHMER_CHAR_PATTERN.test(text)) {
    return "km";
  }

  return undefined;
}

function detectLatinSupportedLanguage(
  text: string
): Extract<SupportedReviewLanguage, "en" | "vi"> | undefined {
  if (isReviewPackageMetadataLine(text)) {
    return undefined;
  }

  if (isVietnameseSegment(text)) {
    return "vi";
  }

  if (isEnglishSegment(text)) {
    return "en";
  }

  return undefined;
}

function latinWordLanguage(word: string): Extract<SupportedReviewLanguage, "en" | "vi"> | undefined {
  const folded = foldLatin(word);

  if (VIETNAMESE_MARKER_PATTERN.test(word) || VIETNAMESE_FINANCIAL_WORDS.has(folded)) {
    return "vi";
  }

  if (ENGLISH_FINANCIAL_WORDS.has(folded)) {
    return "en";
  }

  return undefined;
}

function foldLatin(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function isVietnameseSegment(text: string) {
  if (VIETNAMESE_FINANCIAL_AD_TERMS.test(text)) {
    return true;
  }

  const foldedText = foldLatin(text);
  const vietnameseTermCount = foldedText
    .split(/[^\p{Script=Latin}]+/u)
    .filter((word) => VIETNAMESE_FINANCIAL_WORDS.has(word)).length;

  return VIETNAMESE_MARKER_PATTERN.test(text) && vietnameseTermCount > 0;
}

function isEnglishSegment(text: string) {
  if (isReviewPackageMetadataLine(text)) {
    return false;
  }

  if (ENGLISH_FINANCIAL_AD_TERMS.test(text)) {
    return true;
  }

  const latinLetters = text.match(LATIN_LETTER_COUNT_PATTERN)?.length ?? 0;
  if (latinLetters === 0) {
    return false;
  }

  const letters = text.match(/[\p{L}]/gu)?.length ?? 0;
  return letters > 0 && latinLetters / letters >= 0.45;
}

function isReviewPackageMetadataLine(text: string) {
  return (
    HANGUL_PATTERN.test(text) &&
    REVIEW_PACKAGE_METADATA_PATTERN.test(text) &&
    REVIEW_PACKAGE_METADATA_KOREAN_PATTERN.test(text)
  );
}

function normalizeSegmentText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function trimBoundaryPunctuation(text: string) {
  return text
    .replace(/^[\s:;|/\\()[\]{}"'“”‘’.,!?-]+/u, "")
    .replace(/[\s:;|/\\()[\]{}"'“”‘’.,!?-]+$/u, "")
    .trim();
}

function segmentId(language: SupportedReviewLanguage, counter: number) {
  return `seg-${language}-${counter.toString().padStart(3, "0")}`;
}

function segmentConfidence(
  language: SupportedReviewLanguage,
  text: string,
  documentConfidence: number
) {
  const detectedConfidence =
    (language === "en" && ENGLISH_FINANCIAL_AD_TERMS.test(text)) ||
    (language === "vi" && VIETNAMESE_FINANCIAL_AD_TERMS.test(text))
      ? 0.94
      : 0.9;

  return Math.min(documentConfidence, detectedConfidence);
}
