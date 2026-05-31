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
  localizedFindingId: LocalizedRiskFinding["segmentId"];
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
const LATIN_LETTER_PATTERN = /[A-Za-z]/g;
const JAPANESE_KANA_PATTERN = /[\u3040-\u30ff]/;
const JAPANESE_HAN_AD_TERMS = /(審査|手数料|無料|金利|優遇)/;
const HAN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const HANGUL_PATTERN = /[\uac00-\ud7af]/;

type SegmentCounter = Record<SupportedReviewLanguage, number>;

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
      const normalizedText = normalizeSegmentText(line);
      if (normalizedText.length === 0) {
        continue;
      }

      const language = detectSupportedLanguage(normalizedText);
      if (language === undefined) {
        continue;
      }

      counters[language] += 1;
      segments.push({
        id: segmentId(language, counters[language]),
        language,
        originalText: line.trim(),
        normalizedText,
        sourceFileId: document.fileId,
        confidence: segmentConfidence(language, normalizedText, document.confidence)
      });
    }
  }

  return segments;
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

  const latinLetters = text.match(LATIN_LETTER_PATTERN)?.length ?? 0;
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
