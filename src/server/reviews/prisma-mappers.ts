import type {
  Evidence,
  MultilingualIssueContext,
  ReviewCase,
  ReviewFile,
  ReviewIssue,
  ReviewSummary
} from "@/domain/types";

type PrismaFileRow = {
  id: string;
  originalFilename: string;
  fileType: ReviewFile["fileType"];
  classificationConfidence: number;
  parseStatus: ReviewFile["parseStatus"];
  storageProvider: NonNullable<ReviewFile["storageProvider"]>;
  storageKey: string;
  contentType: string;
  sizeBytes: bigint;
};

type PrismaEvidenceRow = Omit<
  Evidence,
  "page" | "section" | "documentId" | "chunkId" | "version" | "effectiveFrom"
> & {
  page: number | null;
  section: string | null;
  documentId: string | null;
  chunkId: string | null;
  version: string | null;
  effectiveFrom: Date | null;
};

type PrismaIssueRow = Omit<
  ReviewIssue,
  | "targetBbox"
  | "targetFileId"
  | "targetPage"
  | "confidence"
  | "agentFindingId"
  | "sourceAgents"
  | "evidence"
  | "reviewerRiskLevel"
  | "finalAction"
  | "reviewerComment"
> & {
  reviewerRiskLevel: ReviewIssue["reviewerRiskLevel"] | null;
  finalAction: ReviewIssue["finalAction"] | null;
  reviewerComment: string | null;
  targetBbox: unknown;
  targetFileId: string | null;
  targetPage: number | null;
  confidence: number | null;
  agentFindingId: string | null;
  agentFinding: { outputSnapshot: unknown } | null;
  sourceAgents: unknown;
  evidence: PrismaEvidenceRow[];
};

export type PrismaReviewCaseRow = {
  id: string;
  title: string;
  affiliateName: string;
  productType: ReviewCase["productType"];
  channelType: unknown;
  plannedPublishDate: Date | null;
  status: ReviewCase["status"];
  highestRiskLevel: ReviewCase["highestRiskLevel"];
  requesterName: string;
  reviewerName: string;
  promotionalCopy: string;
  disclosure: string;
  productDescription: string;
  missingMaterials: unknown;
  files: PrismaFileRow[];
  issues: PrismaIssueRow[];
  expectedDraft: string;
  currentDraft: string | null;
  currentDraftVersion: number;
  analysisNotice: string | null;
};

function stringArray(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      return stringArray(JSON.parse(value));
    } catch {
      return [];
    }
  }

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return objectValue(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function supportedLanguage(value: unknown): MultilingualIssueContext["language"] | undefined {
  return value === "en" || value === "ja" || value === "zh" ? value : undefined;
}

function riskCategory(value: unknown): MultilingualIssueContext["riskCategory"] | undefined {
  return value === "expression_risk" || value === "compliance_risk" || value === "both"
    ? value
    : undefined;
}

function multilingualContextFromSnapshot(
  snapshot: unknown
): MultilingualIssueContext | undefined {
  const outputSnapshot = objectValue(snapshot);
  const localized = objectValue(outputSnapshot?.localizedRiskFinding);
  const mapping = objectValue(outputSnapshot?.koreanComplianceMapping);
  const segmentId = stringValue(localized?.segmentId);
  const language = supportedLanguage(localized?.language);
  const originalText = stringValue(localized?.originalText);
  const literalTranslation = stringValue(localized?.literalTranslation);
  const complianceMeaning = stringValue(localized?.complianceMeaning);
  const localizedRiskCategory = riskCategory(localized?.riskCategory);
  const koreanComplianceCategory = stringValue(mapping?.koreanComplianceCategory);
  const koreanComplianceReason = stringValue(mapping?.koreanComplianceReason);
  const evidenceQuery = stringValue(mapping?.evidenceQuery);
  const suggestedCopyOriginalLanguage = stringValue(localized?.suggestedCopyOriginalLanguage);
  const suggestedCopyKoreanMeaning = stringValue(localized?.suggestedCopyKoreanMeaning);

  if (
    !segmentId ||
    !language ||
    !originalText ||
    !literalTranslation ||
    !complianceMeaning ||
    !localizedRiskCategory ||
    !koreanComplianceCategory ||
    !koreanComplianceReason ||
    !evidenceQuery ||
    !suggestedCopyOriginalLanguage ||
    !suggestedCopyKoreanMeaning
  ) {
    return undefined;
  }

  return {
    segmentId,
    language,
    originalText,
    literalTranslation,
    complianceMeaning,
    riskCategory: localizedRiskCategory,
    riskSignals: stringArray(localized?.riskSignals),
    koreanComplianceCategory,
    koreanComplianceReason,
    evidenceQuery,
    suggestedCopyOriginalLanguage,
    suggestedCopyKoreanMeaning
  };
}

function bbox(value: unknown): [number, number, number, number] {
  const values = Array.isArray(value) ? value : [0, 0, 0, 0];

  return [
    Number(values[0] ?? 0),
    Number(values[1] ?? 0),
    Number(values[2] ?? 0),
    Number(values[3] ?? 0)
  ];
}

function dateString(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

function toFile(row: PrismaFileRow): ReviewFile {
  return {
    id: row.id,
    name: row.originalFilename,
    fileType: row.fileType,
    classificationConfidence: row.classificationConfidence,
    parseStatus: row.parseStatus,
    storageProvider: row.storageProvider,
    storageKey: row.storageKey,
    contentType: row.contentType,
    sizeBytes: Number(row.sizeBytes)
  };
}

function toEvidence(row: PrismaEvidenceRow): Evidence {
  const evidence = {
    id: row.id,
    sourceType: row.sourceType,
    title: row.title,
    page: row.page ?? undefined,
    section: row.section ?? undefined,
    quoteSummary: row.quoteSummary,
    relevanceScore: row.relevanceScore,
    documentId: row.documentId ?? undefined,
    chunkId: row.chunkId ?? undefined,
    version: row.version ?? undefined,
    effectiveFrom: row.effectiveFrom ? row.effectiveFrom.toISOString().slice(0, 10) : undefined
  };

  return evidence;
}

function toIssue(row: PrismaIssueRow): ReviewIssue {
  const issue = {
    id: row.id,
    issueType: row.issueType,
    riskLevel: row.riskLevel,
    reviewerRiskLevel: row.reviewerRiskLevel ?? undefined,
    title: row.title,
    targetText: row.targetText,
    targetBbox: bbox(row.targetBbox),
    targetFileId: row.targetFileId ?? undefined,
    targetPage: row.targetPage ?? undefined,
    confidence: row.confidence ?? undefined,
    agentFindingId: row.agentFindingId ?? undefined,
    sourceAgents: stringArray(row.sourceAgents),
    suggestedAction: row.suggestedAction,
    finalAction: row.finalAction ?? undefined,
    reviewerComment: row.reviewerComment ?? undefined,
    status: row.status,
    description: row.description,
    suggestedCopy: row.suggestedCopy,
    multilingualContext: multilingualContextFromSnapshot(row.agentFinding?.outputSnapshot),
    evidence: row.evidence.map(toEvidence)
  };

  return issue;
}

export function toReviewCase(row: PrismaReviewCaseRow): ReviewCase {
  return {
    id: row.id,
    title: row.title,
    affiliate: row.affiliateName,
    productType: row.productType,
    channelType: stringArray(row.channelType),
    plannedPublishDate: dateString(row.plannedPublishDate),
    status: row.status,
    highestRiskLevel: row.highestRiskLevel,
    requester: row.requesterName,
    reviewer: row.reviewerName,
    promotionalCopy: row.promotionalCopy,
    disclosure: row.disclosure,
    productDescription: row.productDescription,
    missingMaterials: stringArray(row.missingMaterials),
    files: row.files.map(toFile),
    issues: row.issues.map(toIssue),
    expectedDraft: row.expectedDraft,
    currentDraft: row.currentDraft ?? undefined,
    currentDraftVersion: row.currentDraftVersion,
    analysisNotice: row.analysisNotice ?? undefined
  };
}

export function toReviewSummary(row: PrismaReviewCaseRow): ReviewSummary {
  return {
    id: row.id,
    title: row.title,
    affiliate: row.affiliateName,
    productType: row.productType,
    plannedPublishDate: dateString(row.plannedPublishDate),
    status: row.status,
    highestRiskLevel: row.highestRiskLevel,
    requester: row.requesterName,
    reviewer: row.reviewerName
  };
}
