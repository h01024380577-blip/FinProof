import type { Evidence, ReviewCase, ReviewFile, ReviewIssue, ReviewSummary } from "@/domain/types";

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

type PrismaEvidenceRow = Evidence;

type PrismaIssueRow = Omit<ReviewIssue, "targetBbox" | "sourceAgents" | "evidence"> & {
  targetBbox: unknown;
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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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
  return {
    id: row.id,
    sourceType: row.sourceType,
    title: row.title,
    page: row.page,
    section: row.section,
    quoteSummary: row.quoteSummary,
    relevanceScore: row.relevanceScore
  };
}

function toIssue(row: PrismaIssueRow): ReviewIssue {
  return {
    id: row.id,
    issueType: row.issueType,
    riskLevel: row.riskLevel,
    reviewerRiskLevel: row.reviewerRiskLevel ?? undefined,
    title: row.title,
    targetText: row.targetText,
    targetBbox: bbox(row.targetBbox),
    sourceAgents: stringArray(row.sourceAgents),
    suggestedAction: row.suggestedAction,
    finalAction: row.finalAction ?? undefined,
    reviewerComment: row.reviewerComment ?? undefined,
    status: row.status,
    description: row.description,
    suggestedCopy: row.suggestedCopy,
    evidence: row.evidence.map(toEvidence)
  };
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
