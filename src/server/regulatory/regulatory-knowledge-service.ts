import { createHash } from "node:crypto";
import type {
  KnowledgeDocumentType,
  ProductType,
  RegulatoryChangeSet,
  RegulatoryChangedSection
} from "@/domain/types";
import type { RequestContext } from "@/server/auth/request-context";
import { createKnowledgeDocumentChunks } from "@/server/knowledge/knowledge-ingestion";
import { getReviewStore } from "@/server/reviews";
import type { ReviewStore, ReviewStoreScope } from "@/server/reviews/review-store";
import { detectRegulatoryChanges } from "./change-diff";
import { normalizeRegulatoryText } from "./normalizer";
import { qualityGateStatus, runRegulatoryQualityGates } from "./quality-gates";

type RegulatoryKnowledgeServiceDeps = {
  store?: ReviewStore;
  now?: () => Date;
};

type RunSourceCheckInput = {
  sourceId: string;
  title: string;
  version: string;
  sourceText: string;
  previousNormalizedText?: string;
  previousContentHash?: string;
  effectiveFrom?: string;
  documentType: KnowledgeDocumentType;
  productType?: ProductType;
  mappedChannels?: string[];
  mappedReviewCategories?: string[];
  activateKnowledgeDocument?: boolean;
  baselineOnly?: boolean;
};

type RunSourceCheckResult = {
  sourceId: string;
  snapshotCreated: boolean;
  activated: boolean;
  changeSetCount: number;
  activatedDocumentIds: string[];
};

export class RegulatorySourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegulatorySourceNotFoundError";
  }
}

export class RegulatorySourceCheckInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegulatorySourceCheckInputError";
  }
}

function scopeFromContext(context: RequestContext): ReviewStoreScope {
  return {
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorRole: context.role,
    ipAddress: context.ipAddress
  };
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function timeStamp(now: () => Date): string {
  return now()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
}

function idSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

  return sanitized.slice(0, 80) || "source";
}

function impactSummary(changeSet: Pick<RegulatoryChangeSet, "changedSections">): string {
  return changeSet.changedSections
    .map((section) => section.newText ?? section.previousText ?? section.title)
    .join(" ");
}

function riskImpactLevel(text: string): RegulatoryChangeSet["riskImpactLevel"] {
  return /최고금리|보장|필수|제한|금지/.test(text) ? "high" : "caution";
}

function sourceCanonicalKey(source: { sourceType: string; id: string }): string {
  return `${source.sourceType}:${source.id}`;
}

function canonicalSegment(value: string): string {
  const readable = idSegment(value);

  return readable === "source" ? `h-${contentHash(value).slice(0, 12)}` : readable;
}

function changeCanonicalKey(
  source: { sourceType: string; id: string },
  change: { changedSections: RegulatoryChangedSection[] }
): string {
  const [section] = change.changedSections;
  const sectionPart = section
    ? canonicalSegment(section.sectionNumber ?? section.title ?? section.sectionId)
    : "document";

  return `${sourceCanonicalKey(source)}:${sectionPart}`;
}

function sourceCheckIds(sourceId: string, hash: string, now: () => Date, index: number) {
  const sourcePart = idSegment(sourceId);
  const hashPart = hash.slice(0, 12);
  const timePart = timeStamp(now);
  const sequence = String(index + 1).padStart(3, "0");
  const snapshotId = `reg-snapshot-${sourcePart}-${timePart}-${hashPart}`;
  const changeSetId = `reg-change-${sourcePart}-${timePart}-${hashPart}-${sequence}`;

  return {
    snapshotId,
    changeSetId,
    documentId: `knowledge-auto-${changeSetId}`
  };
}

function qualityGateAuditAction(status: RegulatoryChangeSet["qualityGateStatus"]): string {
  if (status === "failed") {
    return "regulatory_change.quality_gate_failed";
  }

  if (status === "flagged") {
    return "regulatory_change.quality_gate_flagged";
  }

  return "regulatory_change.quality_gate_passed";
}

function changeSetCandidate(
  scope: ReviewStoreScope,
  input: RunSourceCheckInput,
  sourceId: string,
  previousSnapshotId: string | undefined,
  newSnapshotId: string,
  changeSetId: string,
  changeType: RegulatoryChangeSet["changeType"],
  changedSections: RegulatoryChangedSection[],
  summaryText: string,
  qualityGateStatus: RegulatoryChangeSet["qualityGateStatus"]
): RegulatoryChangeSet {
  return {
    id: changeSetId,
    tenantId: scope.tenantId,
    sourceId,
    previousSnapshotId,
    newSnapshotId,
    changeType,
    changeSummary: `${input.title} 변경: ${changedSections[0]?.title ?? "본문"}`,
    changedSections,
    effectiveFrom: input.effectiveFrom,
    riskImpactLevel: riskImpactLevel(summaryText),
    interpretationSummary: `${input.title} 변경분은 광고 심의 지식베이스에 자동 반영됩니다.`,
    mappedProductTypes: input.productType ? [input.productType] : [],
    mappedChannels: input.mappedChannels ?? [],
    mappedReviewCategories: input.mappedReviewCategories ?? [],
    qualityGateStatus,
    confidence: 0.9,
    createdAt: new Date(0).toISOString()
  };
}

function createChangeSetInput(candidate: RegulatoryChangeSet) {
  return {
    id: candidate.id,
    sourceId: candidate.sourceId,
    previousSnapshotId: candidate.previousSnapshotId,
    newSnapshotId: candidate.newSnapshotId,
    changeType: candidate.changeType,
    changeSummary: candidate.changeSummary,
    changedSections: candidate.changedSections,
    effectiveFrom: candidate.effectiveFrom,
    riskImpactLevel: candidate.riskImpactLevel,
    interpretationSummary: candidate.interpretationSummary,
    mappedProductTypes: candidate.mappedProductTypes,
    mappedChannels: candidate.mappedChannels,
    mappedReviewCategories: candidate.mappedReviewCategories,
    qualityGateStatus: candidate.qualityGateStatus,
    confidence: candidate.confidence
  };
}

export function createRegulatoryKnowledgeService({
  store = getReviewStore(),
  now = () => new Date()
}: RegulatoryKnowledgeServiceDeps = {}) {
  return {
    async runSourceCheck(
      context: RequestContext,
      input: RunSourceCheckInput
    ): Promise<RunSourceCheckResult> {
      const scope = scopeFromContext(context);
      const source = await store.getRegulatorySource(scope, input.sourceId);

      if (!source) {
        throw new RegulatorySourceNotFoundError("Regulatory source not found");
      }

      const hash = contentHash(input.sourceText);
      const previousSnapshot = await store.getLatestRegulatorySnapshot(scope, input.sourceId);

      if (previousSnapshot?.contentHash === hash) {
        await store.recordAuditEvent(scope, {
          action: "regulatory_source.checked",
          targetType: "regulatory_source",
          targetId: input.sourceId,
          afterValue: { unchanged: true, contentHash: hash }
        });

        return {
          sourceId: input.sourceId,
          snapshotCreated: false,
          activated: false,
          changeSetCount: 0,
          activatedDocumentIds: []
        };
      }

      if (previousSnapshot) {
        if (!input.previousNormalizedText) {
          throw new RegulatorySourceCheckInputError(
            "previousNormalizedText is required when a previous snapshot exists"
          );
        }

        const previousTextHash = contentHash(input.previousNormalizedText);

        if (
          previousTextHash !== previousSnapshot.contentHash ||
          (input.previousContentHash && input.previousContentHash !== previousTextHash)
        ) {
          throw new RegulatorySourceCheckInputError(
            "previousNormalizedText does not match the latest snapshot"
          );
        }
      }

      const snapshotId = sourceCheckIds(input.sourceId, hash, now, 0).snapshotId;
      const snapshot = await store.createRegulatorySnapshot(scope, {
        id: snapshotId,
        sourceId: input.sourceId,
        sourceUrl: source.url,
        title: input.title,
        effectiveFrom: input.effectiveFrom,
        contentHash: hash,
        rawStorageKey: `regulatory/raw/${snapshotId}.txt`,
        normalizedStorageKey: `regulatory/normalized/${snapshotId}.json`,
        detectedDocumentType: input.documentType,
        fetchStatus: "fetched",
        normalizationConfidence: 0.96
      });

      await store.recordAuditEvent(scope, {
        action: "regulatory_snapshot.created",
        targetType: "regulatory_snapshot",
        targetId: snapshot.id,
        afterValue: { sourceId: source.id, contentHash: hash }
      });

      if (input.baselineOnly && !previousSnapshot) {
        return {
          sourceId: source.id,
          snapshotCreated: true,
          activated: false,
          changeSetCount: 0,
          activatedDocumentIds: []
        };
      }

      const previousSections =
        previousSnapshot && input.previousNormalizedText
          ? normalizeRegulatoryText({
              snapshotId: previousSnapshot.id,
              text: input.previousNormalizedText
            })
          : [];
      const nextSections = normalizeRegulatoryText({
        snapshotId: snapshot.id,
        text: input.sourceText
      });
      const detectedChanges = detectRegulatoryChanges({
        previousSnapshotId: previousSnapshot?.id,
        newSnapshotId: snapshot.id,
        previous: previousSections,
        next: nextSections
      });
      const activatedDocumentIds: string[] = [];

      for (const [index, detectedChange] of detectedChanges.entries()) {
        const ids = sourceCheckIds(source.id, hash, now, index);
        const changeSetId = ids.changeSetId;
        const summaryText = impactSummary({ changedSections: detectedChange.changedSections });
        const documentId = ids.documentId;
        const canonicalKey = changeCanonicalKey(source, detectedChange);
        const chunks = await createKnowledgeDocumentChunks({
          tenantId: scope.tenantId,
          documentId,
          text: summaryText,
          now
        });
        const candidate = changeSetCandidate(
          scope,
          input,
          source.id,
          previousSnapshot?.id,
          snapshot.id,
          changeSetId,
          detectedChange.changeType,
          detectedChange.changedSections,
          summaryText,
          "passed"
        );
        const gateResults = runRegulatoryQualityGates({
          changeSet: candidate,
          regressionRetrieved: chunks.length > 0,
          rollbackTargetReady: true,
          now
        });
        const gateStatus = qualityGateStatus(gateResults);
        const changeSet = await store.createRegulatoryChangeSet(
          scope,
          createChangeSetInput(
            changeSetCandidate(
              scope,
              input,
              source.id,
              previousSnapshot?.id,
              snapshot.id,
              changeSetId,
              detectedChange.changeType,
              detectedChange.changedSections,
              summaryText,
              gateStatus
            )
          )
        );

        await store.replaceQualityGateResults(scope, changeSet.id, gateResults);

        await store.recordAuditEvent(scope, {
          action: qualityGateAuditAction(gateStatus),
          targetType: "regulatory_change_set",
          targetId: changeSet.id,
          afterValue: { gateStatus }
        });

        if (gateStatus === "failed") {
          continue;
        }

        if (input.activateKnowledgeDocument === false) {
          continue;
        }

        let activation;

        try {
          activation = await store.activateRegulatoryChangeSet(scope, {
            changeSetId: changeSet.id,
            qualityGateStatus: gateStatus,
            document: {
              id: documentId,
              documentType: input.documentType,
              productType: input.productType,
              title: input.title,
              version: input.version,
              effectiveFrom: input.effectiveFrom ?? now().toISOString().slice(0, 10),
              storageKey: `generated/regulatory/${changeSet.id}.md`,
              canonicalKey,
              sourceSnapshotId: snapshot.id,
              changeSetId: changeSet.id,
              autoIngested: true,
              interpretationSummary: changeSet.interpretationSummary
            },
            chunks: chunks.map((chunk, chunkIndex) => ({
              ...chunk,
              canonicalSectionKey: `${canonicalKey}:${String(chunkIndex + 1).padStart(3, "0")}`,
              sectionNumber: detectedChange.changedSections[chunkIndex]?.sectionNumber,
              changeSetId: changeSet.id,
              chunkStatus: "active",
              impactTags: [
                ...changeSet.mappedProductTypes,
                ...changeSet.mappedChannels,
                ...changeSet.mappedReviewCategories
              ],
              effectiveFrom: input.effectiveFrom,
              sourceReliability: 0.95
            }))
          });
        } catch (error) {
          await store.recordAuditEvent(scope, {
            action: "regulatory_change.activation_failed",
            targetType: "regulatory_change_set",
            targetId: changeSet.id,
            afterValue: { error: error instanceof Error ? error.message : String(error) }
          });
          throw error;
        }

        if (activation) {
          activatedDocumentIds.push(activation.document.id);
          await store.recordAuditEvent(scope, {
            action: "knowledge_document.auto_versioned",
            targetType: "knowledge_document",
            targetId: activation.document.id,
            afterValue: {
              changeSetId: changeSet.id,
              chunkCount: activation.chunks.length
            }
          });
        }
      }

      return {
        sourceId: source.id,
        snapshotCreated: true,
        activated: activatedDocumentIds.length > 0,
        changeSetCount: detectedChanges.length,
        activatedDocumentIds
      };
    }
  };
}
