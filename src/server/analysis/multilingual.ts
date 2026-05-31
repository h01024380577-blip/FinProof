import type { ReviewIssue } from "@/domain/types";
import type { ExtractedDocument } from "./review-analysis-pipeline";

export type SupportedReviewLanguage = "en" | "ja" | "zh";

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
  riskLevelHint: "info" | "caution" | "high" | "reject_recommended";
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
    | "japanese_translator_risk"
    | "chinese_translator_risk"
    | "korean_compliance_mapping";
  language?: SupportedReviewLanguage;
  message: string;
};

const ENGLISH_FINANCIAL_AD_TERMS =
  /\b(approval|approved|guaranteed|guarantee|loan|rate|rates|fee|fees|screening|eligible|instant|lowest|hidden)\b/i;
const LATIN_LETTER_COUNT_PATTERN = /[A-Za-z]/g;
const LATIN_LETTER_PATTERN = /[A-Za-z]/;
const JAPANESE_KANA_PATTERN = /[\u3040-\u30ff]/;
const JAPANESE_HAN_AD_TERMS = /(審査|手数料|無料|金利|優遇)/;
const HAN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const HANGUL_PATTERN = /[\uac00-\ud7af]/;
const NON_CJK_LATIN_SPAN_PATTERN =
  /[^\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/gu;
const CJK_SPAN_PATTERN =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff0-9０-９%％.．,，·・ー〜~]+/gu;

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
    ja: 0,
    zh: 0
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
    ...detectedCjkSpans(text)
  ].sort((left, right) => left.index - right.index);
}

function detectedLatinSpans(text: string): DetectedLanguageSpan[] {
  return [...text.matchAll(NON_CJK_LATIN_SPAN_PATTERN)]
    .map((match) => ({
      text: trimBoundaryPunctuation(match[0]),
      index: match.index ?? 0
    }))
    .filter((span) => isEnglishSegment(span.text))
    .map((span) => ({
      language: "en" as const,
      text: span.text,
      index: span.index
    }));
}

function detectedCjkSpans(text: string): DetectedLanguageSpan[] {
  return [...text.matchAll(CJK_SPAN_PATTERN)]
    .map((match) => ({
      text: trimBoundaryPunctuation(match[0]),
      index: match.index ?? 0
    }))
    .map((span): DetectedLanguageSpan | undefined => {
      if (span.text.length === 0) {
        return undefined;
      }

      if (isJapaneseSegment(span.text)) {
        return {
          language: "ja",
          text: span.text,
          index: span.index
        };
      }

      if (HAN_PATTERN.test(span.text) && !isKoreanOnlySegment(span.text)) {
        return {
          language: "zh",
          text: span.text,
          index: span.index
        };
      }

      return undefined;
    })
    .filter((span): span is DetectedLanguageSpan => Boolean(span));
}

function detectSupportedLanguage(text: string): SupportedReviewLanguage | undefined {
  if (isEnglishSegment(text)) {
    return "en";
  }

  if (isJapaneseSegment(text)) {
    return "ja";
  }

  if (HAN_PATTERN.test(text) && !JAPANESE_KANA_PATTERN.test(text) && !isKoreanOnlySegment(text)) {
    return "zh";
  }

  return undefined;
}

function isEnglishSegment(text: string) {
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

function isJapaneseSegment(text: string) {
  return JAPANESE_KANA_PATTERN.test(text) || JAPANESE_HAN_AD_TERMS.test(text);
}

function isKoreanOnlySegment(text: string) {
  return HANGUL_PATTERN.test(text) && !LATIN_LETTER_PATTERN.test(text) && !HAN_PATTERN.test(text);
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
  const detectedConfidence = language === "en" && ENGLISH_FINANCIAL_AD_TERMS.test(text) ? 0.94 : 0.9;

  return Math.min(documentConfidence, detectedConfidence);
}
