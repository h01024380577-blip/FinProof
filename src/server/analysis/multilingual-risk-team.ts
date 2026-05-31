import type { ReviewCase, ReviewIssue, RiskLevel } from "@/domain/types";
import type { ModelProvider } from "@/server/ai/model-provider";
import type {
  KoreanComplianceMapping,
  LocalizedRiskFinding,
  MultilingualAgentError,
  MultilingualSegment,
  SupportedReviewLanguage
} from "./multilingual";
import type { RagEvidenceCandidate } from "./review-analysis-pipeline";
import type { AgentFinding, ReviewSubAgentId } from "./review-subagents";

type LanguageAgentId =
  | "english_translator_risk"
  | "japanese_translator_risk"
  | "chinese_translator_risk";

export type MultilingualRiskTeamResult = {
  localizedRiskFindings: LocalizedRiskFinding[];
  koreanComplianceMappings: KoreanComplianceMapping[];
  agentFindings: AgentFinding[];
  errors: MultilingualAgentError[];
};

const languageAgents: Record<SupportedReviewLanguage, LanguageAgentId> = {
  en: "english_translator_risk",
  ja: "japanese_translator_risk",
  zh: "chinese_translator_risk"
};

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.72;
  }

  return Math.max(0, Math.min(1, value));
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const arrayStart = candidate.indexOf("[");
    const arrayEnd = candidate.lastIndexOf("]");

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      return JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
    }

    const objectStart = candidate.indexOf("{");
    const objectEnd = candidate.lastIndexOf("}");

    if (objectStart !== -1 && objectEnd > objectStart) {
      return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
    }
  }

  return [];
}

function rawFindings(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "findings" in parsed &&
    Array.isArray(parsed.findings)
  ) {
    return parsed.findings;
  }

  return [];
}

function rawMappings(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "mappings" in parsed &&
    Array.isArray(parsed.mappings)
  ) {
    return parsed.mappings;
  }

  return [];
}

function stringField(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  if (
    value === "info" ||
    value === "caution" ||
    value === "high" ||
    value === "reject_recommended"
  ) {
    return value;
  }

  return "caution";
}

function normalizeRiskCategory(value: unknown): LocalizedRiskFinding["riskCategory"] {
  if (value === "expression_risk" || value === "compliance_risk" || value === "both") {
    return value;
  }

  return "compliance_risk";
}

function normalizeAction(value: unknown): ReviewIssue["suggestedAction"] {
  if (value === "approve" || value === "change_request" || value === "reject" || value === "hold") {
    return value;
  }

  return "change_request";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function compactText(text: string, maxLength = 1600) {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function reviewPayload(review: ReviewCase) {
  return {
    id: review.id,
    title: review.title,
    affiliate: review.affiliate,
    productType: review.productType,
    channelType: review.channelType,
    plannedPublishDate: review.plannedPublishDate,
    promotionalCopy: compactText(review.promotionalCopy),
    disclosure: compactText(review.disclosure),
    productDescription: compactText(review.productDescription),
    missingMaterials: review.missingMaterials
  };
}

function evidencePayload(evidenceCandidates: RagEvidenceCandidate[]) {
  return evidenceCandidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    quoteSummary: candidate.quoteSummary,
    relevanceScore: candidate.relevanceScore,
    sourceType: candidate.sourceType,
    documentId: candidate.documentId,
    sourceFileId: candidate.sourceFileId
  }));
}

function languageAgentInput(input: {
  review: ReviewCase;
  segments: MultilingualSegment[];
  evidenceCandidates: RagEvidenceCandidate[];
}) {
  return JSON.stringify({
    review: reviewPayload(input.review),
    segments: input.segments.map((segment) => ({
      id: segment.id,
      language: segment.language,
      originalText: segment.originalText,
      normalizedText: segment.normalizedText,
      confidence: segment.confidence,
      sourceFileId: segment.sourceFileId,
      page: segment.page,
      bbox: segment.bbox
    })),
    evidenceCandidates: evidencePayload(input.evidenceCandidates),
    outputSchema: {
      findings:
        "array of { segmentId, language, originalText, literalTranslation, complianceMeaning, riskCategory, riskSignals, riskLevelHint, suggestedCopyOriginalLanguage, suggestedCopyKoreanMeaning, confidence }",
      allowedRiskCategories: ["expression_risk", "compliance_risk", "both"],
      allowedRiskLevelHints: ["info", "caution", "high", "reject_recommended"]
    }
  });
}

function mappingAgentInput(input: {
  review: ReviewCase;
  localizedRiskFindings: LocalizedRiskFinding[];
  evidenceCandidates: RagEvidenceCandidate[];
}) {
  return JSON.stringify({
    review: reviewPayload(input.review),
    localizedRiskFindings: input.localizedRiskFindings,
    evidenceCandidates: evidencePayload(input.evidenceCandidates),
    outputSchema: {
      mappings:
        "array of { localizedFindingId, issueType, koreanComplianceCategory, koreanComplianceReason, evidenceQuery, suggestedAction }",
      allowedSuggestedActions: ["approve", "change_request", "reject", "hold"]
    }
  });
}

function normalizeLocalizedFinding(
  item: unknown,
  segmentById: Map<string, MultilingualSegment>
): LocalizedRiskFinding | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  const fields = item as Record<string, unknown>;
  const segmentId = stringField(fields.segmentId);
  const segment = segmentById.get(segmentId);
  const complianceMeaning = stringField(fields.complianceMeaning);

  if (!segment || !complianceMeaning) {
    return undefined;
  }

  return {
    segmentId,
    language: segment.language,
    originalText: segment.originalText,
    literalTranslation: stringField(fields.literalTranslation, segment.originalText),
    complianceMeaning,
    riskCategory: normalizeRiskCategory(fields.riskCategory),
    riskSignals: stringArray(fields.riskSignals),
    riskLevelHint: normalizeRiskLevel(fields.riskLevelHint),
    suggestedCopyOriginalLanguage: stringField(
      fields.suggestedCopyOriginalLanguage,
      segment.originalText
    ),
    suggestedCopyKoreanMeaning: stringField(fields.suggestedCopyKoreanMeaning),
    confidence: clampConfidence(fields.confidence)
  };
}

function normalizeMapping(
  item: unknown,
  findingById: Map<string, LocalizedRiskFinding>
): KoreanComplianceMapping | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  const fields = item as Record<string, unknown>;
  const localizedFindingId = stringField(fields.localizedFindingId);
  const issueType = stringField(fields.issueType);
  const koreanComplianceReason = stringField(fields.koreanComplianceReason);

  if (!findingById.has(localizedFindingId) || !issueType || !koreanComplianceReason) {
    return undefined;
  }

  return {
    localizedFindingId,
    issueType,
    koreanComplianceCategory: stringField(fields.koreanComplianceCategory, "다국어 광고 표현"),
    koreanComplianceReason,
    evidenceQuery: stringField(fields.evidenceQuery, koreanComplianceReason),
    suggestedAction: normalizeAction(fields.suggestedAction)
  };
}

function textTokens(text: string) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function overlapScore(leftText: string, rightText: string) {
  const leftTerms = new Set(textTokens(leftText));
  const rightTerms = new Set(textTokens(rightText));

  return [...leftTerms].filter((term) => rightTerms.has(term)).length;
}

function evidenceMatchText(mapping: KoreanComplianceMapping, finding: LocalizedRiskFinding) {
  return [
    mapping.evidenceQuery,
    mapping.koreanComplianceCategory,
    mapping.koreanComplianceReason,
    finding.complianceMeaning,
    finding.literalTranslation,
    ...finding.riskSignals
  ].join(" ");
}

function primaryEvidenceMatchText(mapping: KoreanComplianceMapping, finding: LocalizedRiskFinding) {
  return [mapping.evidenceQuery, ...finding.riskSignals].join(" ");
}

function candidateMatchText(candidate: RagEvidenceCandidate) {
  return [candidate.title, candidate.quoteSummary, candidate.section].filter(Boolean).join(" ");
}

function topEvidenceIds(
  mapping: KoreanComplianceMapping,
  finding: LocalizedRiskFinding,
  evidenceCandidates: RagEvidenceCandidate[]
) {
  const matchText = evidenceMatchText(mapping, finding);
  const primaryMatchText = primaryEvidenceMatchText(mapping, finding);

  return evidenceCandidates
    .filter((candidate) => candidate.relevanceScore >= 0.72)
    .map((candidate) => {
      const candidateText = candidateMatchText(candidate);
      const primaryScore = overlapScore(primaryMatchText, candidateText);
      const contextScore = overlapScore(matchText, candidateText);

      return {
        candidate,
        score: primaryScore * 3 + contextScore,
        primaryScore,
        contextScore
      };
    })
    .filter(({ primaryScore, contextScore }) => primaryScore > 0 || contextScore >= 2)
    .slice()
    .sort(
      (left, right) =>
        right.score - left.score || right.candidate.relevanceScore - left.candidate.relevanceScore
    )
    .slice(0, 3)
    .map(({ candidate }) => candidate.id);
}

function findingTitle(finding: LocalizedRiskFinding, mapping: KoreanComplianceMapping) {
  if (finding.confidence < 0.65) {
    return "원문 검토 필요";
  }

  return mapping.koreanComplianceCategory;
}

function findingRiskLevel(
  finding: LocalizedRiskFinding,
  mapping: KoreanComplianceMapping
): RiskLevel {
  if (finding.confidence < 0.65) {
    return "caution";
  }

  if (mapping.suggestedAction === "reject") {
    return "reject_recommended";
  }

  return finding.riskLevelHint;
}

function findingSuggestedAction(
  finding: LocalizedRiskFinding,
  mapping: KoreanComplianceMapping
): ReviewIssue["suggestedAction"] {
  return finding.confidence < 0.65 ? "hold" : mapping.suggestedAction;
}

function findingDescription(
  finding: LocalizedRiskFinding,
  mapping: KoreanComplianceMapping,
  hasSelectedEvidence: boolean
) {
  const evidenceNote = !hasSelectedEvidence
    ? "연결 가능한 근거 후보가 없어 리뷰어 확인이 필요한 불충분 근거 상태입니다."
    : undefined;

  return [finding.complianceMeaning, mapping.koreanComplianceReason, evidenceNote]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function agentFindingFromMapping(
  mapping: KoreanComplianceMapping,
  finding: LocalizedRiskFinding,
  index: number,
  evidenceCandidates: RagEvidenceCandidate[]
): AgentFinding {
  const evidenceCandidateIds = topEvidenceIds(mapping, finding, evidenceCandidates);

  return {
    id: `finding-korean_compliance_mapping-${String(index + 1).padStart(3, "0")}`,
    agent: "korean_compliance_mapping",
    issueType: mapping.issueType,
    riskLevel: findingRiskLevel(finding, mapping),
    title: findingTitle(finding, mapping),
    targetText: finding.originalText,
    description: findingDescription(finding, mapping, evidenceCandidateIds.length > 0),
    suggestedAction: findingSuggestedAction(finding, mapping),
    suggestedCopy: finding.suggestedCopyOriginalLanguage,
    evidenceCandidateIds,
    confidence: finding.confidence,
    localizedRiskFinding: finding,
    koreanComplianceMapping: mapping
  };
}

export async function runMultilingualRiskTeam(input: {
  review: ReviewCase;
  segments: MultilingualSegment[];
  evidenceCandidates: RagEvidenceCandidate[];
  provider: ModelProvider;
}): Promise<MultilingualRiskTeamResult> {
  const localizedRiskFindings: LocalizedRiskFinding[] = [];
  const errors: MultilingualAgentError[] = [];
  const segmentsByLanguage = new Map<SupportedReviewLanguage, MultilingualSegment[]>();

  for (const segment of input.segments) {
    segmentsByLanguage.set(segment.language, [
      ...(segmentsByLanguage.get(segment.language) ?? []),
      segment
    ]);
  }

  for (const [language, segments] of segmentsByLanguage.entries()) {
    const agentType = languageAgents[language];

    try {
      const result = await input.provider.generateText({
        task: agentType,
        routeContext: {
          lowOcrConfidence: segments.some((segment) => segment.confidence < 0.82)
        },
        instructions: `You are a multilingual financial ad translator risk agent for ${language}. Identify foreign-language financial advertising risk. Return strict JSON only.`,
        input: languageAgentInput({
          review: input.review,
          segments,
          evidenceCandidates: input.evidenceCandidates
        }),
        fallback: "[]"
      });
      const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
      const findings = rawFindings(extractJson(result.text))
        .map((finding) => normalizeLocalizedFinding(finding, segmentById))
        .filter((finding): finding is LocalizedRiskFinding => Boolean(finding));

      localizedRiskFindings.push(...findings);
    } catch (error) {
      errors.push({
        agentType,
        language,
        message: errorMessage(error)
      });
    }
  }

  if (localizedRiskFindings.length === 0) {
    return {
      localizedRiskFindings,
      koreanComplianceMappings: [],
      agentFindings: [],
      errors
    };
  }

  const findingById = new Map(localizedRiskFindings.map((finding) => [finding.segmentId, finding]));
  let koreanComplianceMappings: KoreanComplianceMapping[];

  try {
    const result = await input.provider.generateText({
      task: "korean_compliance_mapping" satisfies ReviewSubAgentId,
      routeContext: {
        evidenceCount: input.evidenceCandidates.length
      },
      instructions:
        "You are a Korean financial advertising compliance mapping agent. Map multilingual localized risks to Korean review issue types. Return strict JSON only.",
      input: mappingAgentInput({
        review: input.review,
        localizedRiskFindings,
        evidenceCandidates: input.evidenceCandidates
      }),
      fallback: "[]"
    });

    koreanComplianceMappings = rawMappings(extractJson(result.text))
      .map((mapping) => normalizeMapping(mapping, findingById))
      .filter((mapping): mapping is KoreanComplianceMapping => Boolean(mapping));
  } catch (error) {
    errors.push({
      agentType: "korean_compliance_mapping",
      message: errorMessage(error)
    });

    return {
      localizedRiskFindings,
      koreanComplianceMappings: [],
      agentFindings: [],
      errors
    };
  }

  const agentFindings = koreanComplianceMappings
    .map((mapping, index) => {
      const finding = findingById.get(mapping.localizedFindingId);

      return finding
        ? agentFindingFromMapping(mapping, finding, index, input.evidenceCandidates)
        : undefined;
    })
    .filter((finding): finding is AgentFinding => Boolean(finding));

  return {
    localizedRiskFindings,
    koreanComplianceMappings,
    agentFindings,
    errors
  };
}
