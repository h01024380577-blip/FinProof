import type {
  Evidence,
  EvidenceChunk,
  KnowledgeDocument,
  MultilingualIssueContext,
  QualityGateResult,
  RegulatoryChangeSet,
  RegulatoryChangedSection,
  RegulatorySnapshot,
  RegulatorySource,
  ReviewCase,
  ReviewFile,
  ReviewIssue,
  ReviewSummary
} from "@/domain/types";
import { filterMatchedEvidence } from "@/domain/evidence";

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
  requestDepartment?: string | null;
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

function requiredStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return strings.length > 0 ? strings : undefined;
}

function supportedLanguage(value: unknown): MultilingualIssueContext["language"] | undefined {
  return value === "en" || value === "vi" || value === "my" || value === "km" ? value : undefined;
}

function riskCategory(value: unknown): MultilingualIssueContext["riskCategory"] | undefined {
  return value === "expression_risk" || value === "compliance_risk" || value === "both"
    ? value
    : undefined;
}

function multilingualContextFromSnapshot(snapshot: unknown): MultilingualIssueContext | undefined {
  const outputSnapshot = objectValue(snapshot);
  const localized = objectValue(outputSnapshot?.localizedRiskFinding);
  const mapping = objectValue(outputSnapshot?.koreanComplianceMapping);
  const segmentId = stringValue(localized?.segmentId);
  const language = supportedLanguage(localized?.language);
  const originalText = stringValue(localized?.originalText);
  const literalTranslation = stringValue(localized?.literalTranslation);
  const complianceMeaning = stringValue(localized?.complianceMeaning);
  const localizedRiskCategory = riskCategory(localized?.riskCategory);
  const riskSignals = requiredStringArray(localized?.riskSignals);
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
    !riskSignals ||
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
    riskSignals,
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

function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function optionalTrimmedString(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function changedSections(value: unknown): RegulatoryChangedSection[] {
  return Array.isArray(value)
    ? value.filter((section): section is RegulatoryChangedSection => {
        if (!section || typeof section !== "object") {
          return false;
        }

        const candidate = section as RegulatoryChangedSection;

        return (
          typeof candidate.sectionId === "string" &&
          typeof candidate.title === "string" &&
          typeof candidate.diffSummary === "string" &&
          !!candidate.citation &&
          typeof candidate.citation.snapshotId === "string" &&
          typeof candidate.citation.sectionId === "string"
        );
      })
    : [];
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
    evidence: filterMatchedEvidence(row.evidence.map(toEvidence))
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
    requestDepartment: optionalTrimmedString(row.requestDepartment),
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
    requestDepartment: optionalTrimmedString(row.requestDepartment),
    reviewer: row.reviewerName
  };
}

export function toKnowledgeDocument(row: {
  id: string;
  tenantId: string;
  affiliateId: string | null;
  documentType: KnowledgeDocument["documentType"];
  productType: KnowledgeDocument["productType"] | null;
  title: string;
  version: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  approvalStatus: KnowledgeDocument["approvalStatus"];
  storageKey: string;
  createdById: string;
  approvedById: string | null;
  canonicalKey: string | null;
  sourceSnapshotId: string | null;
  changeSetId: string | null;
  supersedesDocumentId: string | null;
  lifecycleStatus: NonNullable<KnowledgeDocument["lifecycleStatus"]>;
  autoIngested: boolean;
  sourcePublishedAt: Date | null;
  interpretationSummary: string | null;
  createdAt: Date;
  approvedAt: Date | null;
}): KnowledgeDocument {
  return {
    id: row.id,
    tenantId: row.tenantId,
    affiliateId: row.affiliateId ?? undefined,
    canonicalKey: row.canonicalKey ?? undefined,
    sourceSnapshotId: row.sourceSnapshotId ?? undefined,
    changeSetId: row.changeSetId ?? undefined,
    supersedesDocumentId: row.supersedesDocumentId ?? undefined,
    documentType: row.documentType,
    productType: row.productType ?? undefined,
    title: row.title,
    version: row.version,
    effectiveFrom: dateOnlyString(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? dateOnlyString(row.effectiveTo) : undefined,
    lifecycleStatus: row.lifecycleStatus,
    approvalStatus: row.approvalStatus,
    autoIngested: row.autoIngested,
    sourcePublishedAt: row.sourcePublishedAt ? dateOnlyString(row.sourcePublishedAt) : undefined,
    interpretationSummary: row.interpretationSummary ?? undefined,
    storageKey: row.storageKey,
    createdBy: row.createdById,
    approvedBy: row.approvedById ?? undefined,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString()
  };
}

export function toEvidenceChunk(row: {
  id: string;
  tenantId: string;
  knowledgeDocumentId: string | null;
  reviewFileId: string | null;
  canonicalSectionKey: string | null;
  sectionNumber: string | null;
  changeSetId: string | null;
  supersedesChunkId: string | null;
  chunkText: string;
  chunkSummary: string | null;
  chunkStatus: NonNullable<EvidenceChunk["chunkStatus"]>;
  impactTags: unknown;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  sourceReliability: number | null;
  embeddingModel: string;
  embeddingId: string;
  page: number | null;
  section: string | null;
  metadata: unknown;
  createdAt: Date;
}): EvidenceChunk {
  return {
    id: row.id,
    tenantId: row.tenantId,
    knowledgeDocumentId: row.knowledgeDocumentId ?? undefined,
    reviewFileId: row.reviewFileId ?? undefined,
    canonicalSectionKey: row.canonicalSectionKey ?? undefined,
    sectionNumber: row.sectionNumber ?? undefined,
    changeSetId: row.changeSetId ?? undefined,
    supersedesChunkId: row.supersedesChunkId ?? undefined,
    chunkText: row.chunkText,
    chunkSummary: row.chunkSummary ?? undefined,
    chunkStatus: row.chunkStatus,
    impactTags: stringArray(row.impactTags),
    effectiveFrom: row.effectiveFrom ? dateOnlyString(row.effectiveFrom) : undefined,
    effectiveTo: row.effectiveTo ? dateOnlyString(row.effectiveTo) : undefined,
    sourceReliability: row.sourceReliability ?? undefined,
    embeddingModel: row.embeddingModel,
    embeddingId: row.embeddingId,
    page: row.page ?? undefined,
    section: row.section ?? undefined,
    metadata: jsonObject(row.metadata),
    createdAt: row.createdAt.toISOString()
  };
}

export function toRegulatorySource(row: {
  id: string;
  tenantId: string;
  sourceType: RegulatorySource["sourceType"];
  name: string;
  url: string | null;
  repositoryPath: string | null;
  pollingSchedule: string;
  trustLevel: string;
  lastCheckedAt: Date | null;
  status: RegulatorySource["status"];
  createdAt: Date;
  updatedAt: Date;
}): RegulatorySource {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceType: row.sourceType,
    name: row.name,
    url: row.url ?? undefined,
    repositoryPath: row.repositoryPath ?? undefined,
    pollingSchedule: row.pollingSchedule,
    trustLevel: row.trustLevel as RegulatorySource["trustLevel"],
    lastCheckedAt: row.lastCheckedAt?.toISOString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toRegulatorySnapshot(row: {
  id: string;
  sourceId: string;
  tenantId: string;
  sourceUrl: string | null;
  title: string;
  publishedAt: Date | null;
  effectiveFrom: Date | null;
  contentHash: string;
  rawStorageKey: string;
  normalizedStorageKey: string;
  detectedDocumentType: RegulatorySnapshot["detectedDocumentType"];
  fetchStatus: RegulatorySnapshot["fetchStatus"];
  normalizationConfidence: number;
  createdAt: Date;
}): RegulatorySnapshot {
  return {
    id: row.id,
    sourceId: row.sourceId,
    tenantId: row.tenantId,
    sourceUrl: row.sourceUrl ?? undefined,
    title: row.title,
    publishedAt: row.publishedAt ? dateOnlyString(row.publishedAt) : undefined,
    effectiveFrom: row.effectiveFrom ? dateOnlyString(row.effectiveFrom) : undefined,
    contentHash: row.contentHash,
    rawStorageKey: row.rawStorageKey,
    normalizedStorageKey: row.normalizedStorageKey,
    detectedDocumentType: row.detectedDocumentType,
    fetchStatus: row.fetchStatus,
    normalizationConfidence: row.normalizationConfidence,
    createdAt: row.createdAt.toISOString()
  };
}

export function toRegulatoryChangeSet(row: {
  id: string;
  tenantId: string;
  sourceId: string;
  previousSnapshotId: string | null;
  newSnapshotId: string;
  changeType: RegulatoryChangeSet["changeType"];
  changeSummary: string;
  changedSections: unknown;
  effectiveFrom: Date | null;
  riskImpactLevel: RegulatoryChangeSet["riskImpactLevel"];
  interpretationSummary: string;
  mappedProductTypes: unknown;
  mappedChannels: unknown;
  mappedReviewCategories: unknown;
  qualityGateStatus: RegulatoryChangeSet["qualityGateStatus"];
  confidence: number;
  createdKnowledgeDocumentId: string | null;
  createdAt: Date;
}): RegulatoryChangeSet {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceId: row.sourceId,
    previousSnapshotId: row.previousSnapshotId ?? undefined,
    newSnapshotId: row.newSnapshotId,
    changeType: row.changeType,
    changeSummary: row.changeSummary,
    changedSections: changedSections(row.changedSections),
    effectiveFrom: row.effectiveFrom ? dateOnlyString(row.effectiveFrom) : undefined,
    riskImpactLevel: row.riskImpactLevel,
    interpretationSummary: row.interpretationSummary,
    mappedProductTypes: stringArray(
      row.mappedProductTypes
    ) as RegulatoryChangeSet["mappedProductTypes"],
    mappedChannels: stringArray(row.mappedChannels),
    mappedReviewCategories: stringArray(row.mappedReviewCategories),
    qualityGateStatus: row.qualityGateStatus,
    confidence: row.confidence,
    createdKnowledgeDocumentId: row.createdKnowledgeDocumentId ?? undefined,
    createdAt: row.createdAt.toISOString()
  };
}

export function toQualityGateResult(row: {
  id: string;
  changeSetId: string;
  gateType: QualityGateResult["gateType"];
  status: QualityGateResult["status"];
  summary: string;
  evidence: unknown;
  createdAt: Date;
}): QualityGateResult {
  return {
    id: row.id,
    changeSetId: row.changeSetId,
    gateType: row.gateType,
    status: row.status,
    summary: row.summary,
    evidence: jsonObject(row.evidence),
    createdAt: row.createdAt.toISOString()
  };
}
