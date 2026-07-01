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

// MCP 폴러는 자체 소스 ID 네임스페이스를 쓴다. 기존(수동/track) 경로가 만든
// reg-source-knowledge-* 스냅샷 체인과 충돌하면 previousNormalizedText 해시 불일치로
// 전건 실패하므로, 폴러 소스는 반드시 이 접두사로 분리한다.
const MCP_SOURCE_PREFIX = "mcp-";

// 행정규칙(감독규정·고시·훈령·예규·지침·세칙)은 법령 API(get_law_text)로 못 가져온다.
// 제목으로 판별해 search_admin_rule/get_admin_rule 경로로 라우팅한다.
function isAdminRuleTitle(title: string): boolean {
  return /규정|고시|훈령|예규|지침|세칙/.test(title);
}

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
        const sourceId = MCP_SOURCE_PREFIX + stableRegulatorySourceId(document);
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

          const isAdmin = isAdminRuleTitle(document.title);

          // 해석 우선순위: 캐시 ▸ (법령만) source.url ▸ search_law / search_admin_rule.
          // 캐시/최종 형식: "lawId=...", "mst=...", "admin=<행정규칙일련번호>".
          let resolved =
            (await storage.getRegulatoryLawId({ sourceId, tenantId: context.tenantId })) ??
            (isAdmin ? null : source.url ?? null);

          if (!resolved) {
            let matchedTitle: string | null = null;
            if (isAdmin) {
              const found = await lawClient.searchAdminRule(document.title);
              resolved = found.serialNo ? `admin=${found.serialNo}` : null;
              matchedTitle = found.title ?? null;
            } else {
              const found = await lawClient.searchLaw(document.title);
              resolved = found.lawId ? `lawId=${found.lawId}` : found.mst ? `mst=${found.mst}` : null;
              matchedTitle = found.title ?? null;
            }
            if (!resolved) {
              summary.skipped += 1;
              await safeAudit({
                action: "regulatory_source.poll_skipped",
                targetType: "regulatory_source",
                targetId: sourceId,
                afterValue: { reason: "law_id_unresolved", title: document.title, kind: isAdmin ? "admin_rule" : "law" }
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
                matchedTitle,
                method: isAdmin ? "search_admin_rule" : "search_law",
                query: document.title
              }
            });
          }

          const law = resolved.startsWith("admin=")
            ? await lawClient.getAdminRuleText(resolved.slice("admin=".length))
            : await lawClient.getLawText(parseLawIdentifier(resolved)!);
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
