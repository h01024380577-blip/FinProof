import type { RequestContext } from "@/server/auth/request-context";
import type { KnowledgeDocument } from "@/domain/types";
import { getReviewStore } from "@/server/reviews";
import { getReviewStorageAdapter } from "@/server/storage";
import { createRegulatoryKnowledgeService } from "./regulatory-knowledge-service";
import { createKoreanLawMcpClient, type KoreanLawMcpClient } from "./korean-law-mcp-client";
import {
  regulatorySourceTypeForDocument,
  regulatoryTrustLevelForDocument,
  stableRegulatorySourceId
} from "./knowledge-document-source-mapping";

type PollerScope = {
  tenantId: string;
  actorUserId?: string;
  actorRole?: string;
  ipAddress?: string;
};

export type RegulatorySourcePollerDeps = {
  runSourceCheck?: ReturnType<typeof createRegulatoryKnowledgeService>["runSourceCheck"];
  store?: {
    listKnowledgeDocuments: (scope: PollerScope) => Promise<KnowledgeDocument[]>;
    getRegulatorySource: (scope: PollerScope, sourceId: string) => Promise<unknown>;
    createRegulatorySource: (scope: PollerScope, input: Record<string, unknown>) => Promise<{ id: string; url?: string }>;
    getLatestRegulatorySnapshot: (scope: PollerScope, sourceId: string) => Promise<unknown>;
    recordAuditEvent: (scope: PollerScope, event: Record<string, unknown>) => Promise<unknown>;
  };
  storage?: {
    getRegulatorySourceText: (input: { sourceId: string; tenantId: string }) => Promise<string | null>;
    putRegulatorySourceText: (input: { sourceId: string; tenantId: string; text: string }) => Promise<void>;
    getRegulatoryLawId: (input: { sourceId: string; tenantId: string }) => Promise<string | null>;
    putRegulatoryLawId: (input: { sourceId: string; tenantId: string; lawId: string }) => Promise<void>;
  };
  lawClient?: KoreanLawMcpClient;
  onChange?: (info: { sourceId: string; name: string; changeSetCount: number }) => void;
};

export type PollSummary = { checked: number; changed: number; skipped: number; failed: number };

function parseLawIdentifier(value: string | null | undefined): { lawId?: string; mst?: string } | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("mst=")) return { mst: trimmed.slice(4) };
  if (trimmed.startsWith("lawId=")) return { lawId: trimmed.slice(6) };
  return { lawId: trimmed };
}

function latestDocument(documents: KnowledgeDocument[]): KnowledgeDocument {
  return [...documents].sort((left, right) => {
    const leftKey = [left.effectiveFrom ?? "", left.version, left.createdAt, left.id].join("\0");
    const rightKey = [right.effectiveFrom ?? "", right.version, right.createdAt, right.id].join("\0");
    return leftKey.localeCompare(rightKey);
  })[documents.length - 1];
}

export function createRegulatorySourcePoller(deps: RegulatorySourcePollerDeps = {}) {
  const store = deps.store ?? (getReviewStore() as never);
  const storage = deps.storage ?? getReviewStorageAdapter();
  const runSourceCheck =
    deps.runSourceCheck ?? createRegulatoryKnowledgeService({ store: store as never }).runSourceCheck;
  const lawClient = deps.lawClient ?? createKoreanLawMcpClient();

  return {
    async pollAll(context: RequestContext): Promise<PollSummary> {
      const scope: PollerScope = {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorRole: context.role,
        ipAddress: context.ipAddress
      };
      const safeAudit = async (event: Record<string, unknown>) => {
        try {
          await store.recordAuditEvent(scope, event);
        } catch (auditError) {
          console.error("[regulatory-poll] audit write failed:", (auditError as Error).message);
        }
      };

      const documents = (await store.listKnowledgeDocuments(scope)).filter(
        (document) =>
          document.documentType === "law" &&
          document.approvalStatus === "approved" &&
          document.lifecycleStatus !== "superseded" &&
          !document.autoIngested
      );

      const groups = new Map<string, KnowledgeDocument[]>();
      for (const document of documents) {
        const sourceId = stableRegulatorySourceId(document);
        const group = groups.get(sourceId) ?? [];
        group.push(document);
        groups.set(sourceId, group);
      }

      const summary: PollSummary = { checked: 0, changed: 0, skipped: 0, failed: 0 };

      for (const [sourceId, groupedDocuments] of groups) {
        const document = latestDocument(groupedDocuments);

        try {
          let source = (await store.getRegulatorySource(scope, sourceId)) as
            | { id: string; url?: string }
            | undefined;
          if (!source) {
            source = await store.createRegulatorySource(scope, {
              id: sourceId,
              sourceType: regulatorySourceTypeForDocument(document),
              name: document.title,
              pollingSchedule: "auto",
              trustLevel: regulatoryTrustLevelForDocument(document)
            });
          }

          let identifier = parseLawIdentifier(
            await storage.getRegulatoryLawId({ sourceId, tenantId: context.tenantId })
          );
          if (!identifier) {
            identifier = parseLawIdentifier(source.url);
          }
          if (!identifier) {
            const found = await lawClient.searchLaw(document.title);
            const resolved = found.lawId
              ? `lawId=${found.lawId}`
              : found.mst
                ? `mst=${found.mst}`
                : null;
            if (!resolved) {
              summary.skipped += 1;
              await safeAudit({
                action: "regulatory_source.poll_skipped",
                targetType: "regulatory_source",
                targetId: sourceId,
                afterValue: { reason: "law_id_unresolved", title: document.title }
              });
              continue;
            }
            await storage.putRegulatoryLawId({ sourceId, tenantId: context.tenantId, lawId: resolved });
            await safeAudit({
              action: "regulatory_source.law_id_resolved",
              targetType: "regulatory_source",
              targetId: sourceId,
              afterValue: {
                resolvedIdentifier: resolved,
                matchedTitle: found.title ?? null,
                method: "search_law",
                query: document.title
              }
            });
            identifier = parseLawIdentifier(resolved);
          }

          const law = await lawClient.getLawText(identifier!);
          if (!law.text) {
            summary.skipped += 1;
            await safeAudit({
              action: "regulatory_source.poll_skipped",
              targetType: "regulatory_source",
              targetId: sourceId,
              afterValue: { reason: "empty_law_text" }
            });
            continue;
          }

          const latestSnapshot = await store.getLatestRegulatorySnapshot(scope, sourceId);
          const previousText = latestSnapshot
            ? await storage.getRegulatorySourceText({ sourceId, tenantId: context.tenantId })
            : null;

          const result = await runSourceCheck(context, {
            sourceId,
            title: document.title,
            version: law.effectiveFrom ?? document.version,
            sourceText: law.text,
            previousNormalizedText: previousText ?? undefined,
            effectiveFrom: law.effectiveFrom,
            documentType: "law",
            productType: document.productType,
            mappedChannels: ["korean_law_mcp"],
            mappedReviewCategories: ["law"],
            activateKnowledgeDocument: true,
            baselineOnly: !latestSnapshot
          });

          summary.checked += 1;
          if (result.snapshotCreated) {
            await storage.putRegulatorySourceText({
              sourceId,
              tenantId: context.tenantId,
              text: law.text
            });
          }
          if (result.changeSetCount > 0) {
            summary.changed += 1;
            deps.onChange?.({ sourceId, name: document.title, changeSetCount: result.changeSetCount });
          }
        } catch (error) {
          summary.failed += 1;
          await safeAudit({
            action: "regulatory_source.poll_failed",
            targetType: "regulatory_source",
            targetId: sourceId,
            afterValue: { error: (error as Error).message }
          });
        }
      }

      return summary;
    }
  };
}
