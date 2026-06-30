// src/server/regulatory/regulatory-source-poller.ts
import type { RequestContext } from "@/server/auth/request-context";
import { getReviewStore } from "@/server/reviews";
import { getReviewStorageAdapter } from "@/server/storage";
import { createRegulatoryKnowledgeService } from "./regulatory-knowledge-service";
import { createKoreanLawMcpClient, type KoreanLawMcpClient } from "./korean-law-mcp-client";

type PollerScope = {
  tenantId: string;
  actorUserId?: string;
  actorRole?: string;
  ipAddress?: string;
};

export type RegulatorySourcePollerDeps = {
  runSourceCheck?: ReturnType<typeof createRegulatoryKnowledgeService>["runSourceCheck"];
  store?: {
    listRegulatorySources: (scope: PollerScope) => Promise<unknown[]>;
    getLatestRegulatorySnapshot: (scope: PollerScope, sourceId: string) => Promise<unknown>;
    recordAuditEvent: (scope: PollerScope, event: Record<string, unknown>) => Promise<unknown>;
    updateRegulatorySource?: (scope: PollerScope, id: string, patch: Record<string, unknown>) => Promise<unknown>;
  };
  storage?: {
    getRegulatorySourceText: (input: { sourceId: string; tenantId: string }) => Promise<string | null>;
    putRegulatorySourceText: (input: { sourceId: string; tenantId: string; text: string }) => Promise<void>;
  };
  lawClient?: KoreanLawMcpClient;
  onChange?: (info: { sourceId: string; name: string; changeSetCount: number }) => void;
};

export type PollSummary = { checked: number; changed: number; skipped: number; failed: number };

function parseLawIdentifier(url: string | undefined): { lawId?: string; mst?: string } | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("mst=")) return { mst: trimmed.slice(4) };
  if (trimmed.startsWith("lawId=")) return { lawId: trimmed.slice(6) };
  return { lawId: trimmed };
}

export function createRegulatorySourcePoller(deps: RegulatorySourcePollerDeps = {}) {
  const store = deps.store ?? (getReviewStore() as never);
  const storage = deps.storage ?? getReviewStorageAdapter();
  const runSourceCheck =
    deps.runSourceCheck ?? createRegulatoryKnowledgeService({ store: store as never }).runSourceCheck;
  const lawClient = deps.lawClient ?? createKoreanLawMcpClient();

  return {
    async pollAll(context: RequestContext): Promise<PollSummary> {
      const scope = {
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
      const sources = (await store.listRegulatorySources(scope)) as Array<{
        id: string;
        name: string;
        sourceType: string;
        url?: string;
        status: string;
      }>;
      const summary: PollSummary = { checked: 0, changed: 0, skipped: 0, failed: 0 };

      for (const source of sources) {
        if (source.status !== "active") {
          summary.skipped += 1;
          continue;
        }
        const identifier = parseLawIdentifier(source.url);
        if (!identifier) {
          summary.skipped += 1;
          await safeAudit({
            action: "regulatory_source.poll_skipped",
            targetType: "regulatory_source",
            targetId: source.id,
            afterValue: { reason: "missing_law_identifier" }
          });
          continue;
        }

        try {
          const law = await lawClient.getLawText(identifier);
          if (!law.text) {
            summary.skipped += 1;
            await safeAudit({
              action: "regulatory_source.poll_skipped",
              targetType: "regulatory_source",
              targetId: source.id,
              afterValue: { reason: "empty_law_text" }
            });
            continue;
          }

          const latestSnapshot = await store.getLatestRegulatorySnapshot(scope, source.id);
          const previousText = latestSnapshot
            ? await storage.getRegulatorySourceText({ sourceId: source.id, tenantId: context.tenantId })
            : null;

          const result = await runSourceCheck(context, {
            sourceId: source.id,
            title: source.name,
            version: law.effectiveFrom ?? new Date(0).toISOString().slice(0, 10),
            sourceText: law.text,
            previousNormalizedText: previousText ?? undefined,
            effectiveFrom: law.effectiveFrom,
            documentType: "law",
            mappedChannels: ["korean_law_mcp"],
            mappedReviewCategories: ["law"],
            activateKnowledgeDocument: true,
            baselineOnly: !latestSnapshot
          });

          summary.checked += 1;
          if (result.snapshotCreated) {
            await storage.putRegulatorySourceText({
              sourceId: source.id,
              tenantId: context.tenantId,
              text: law.text
            });
          }
          if (result.changeSetCount > 0) {
            summary.changed += 1;
            deps.onChange?.({ sourceId: source.id, name: source.name, changeSetCount: result.changeSetCount });
          }
          if (store.updateRegulatorySource) {
            await store.updateRegulatorySource(scope, source.id, { lastCheckedAt: new Date().toISOString() });
          }
        } catch (error) {
          summary.failed += 1;
          await safeAudit({
            action: "regulatory_source.poll_failed",
            targetType: "regulatory_source",
            targetId: source.id,
            afterValue: { error: (error as Error).message }
          });
        }
      }

      return summary;
    }
  };
}
