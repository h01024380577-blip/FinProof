import "dotenv/config";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Safely removes ONLY the verification artifacts created by the korean-law-mcp
 * poller runs: RegulatorySource rows whose id starts with "mcp-", their snapshots
 * and change sets, and the matching local storage cache files.
 *
 * It NEVER touches KnowledgeDocuments, or the pre-existing reg-source-knowledge-*
 * sources. Runs as a DRY-RUN by default; pass --execute to actually delete.
 *
 *   npx tsx scripts/cleanup-mcp-regulatory.ts            # preview only
 *   npx tsx scripts/cleanup-mcp-regulatory.ts --execute  # delete
 */
const MCP_PREFIX = "mcp-";

function localRootDir(): string {
  return process.env.FINPROOF_LOCAL_UPLOAD_DIR?.trim() || path.join("/tmp", "finproof-uploads");
}

async function removeLocalCache(tenantId: string, sourceIds: Set<string>, execute: boolean): Promise<number> {
  const root = localRootDir();
  const dirs = [
    path.join(root, "regulatory", "source-text", tenantId),
    path.join(root, "regulatory", "law-id", tenantId)
  ];
  let removed = 0;
  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // dir may not exist on this machine
    }
    for (const entry of entries) {
      const id = entry.replace(/\.txt$/, "");
      if (!sourceIds.has(id) && !entry.startsWith(MCP_PREFIX)) {
        continue;
      }
      const target = path.join(dir, entry);
      console.log(`   ${execute ? "deleted" : "would delete"} local cache: ${target}`);
      if (execute) {
        await unlink(target);
      }
      removed += 1;
    }
  }
  return removed;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const tenantId = process.env.FINPROOF_DEFAULT_TENANT_ID ?? "tenant-demo";
  const store = process.env.FINPROOF_REVIEW_STORE ?? "mock";

  if (store !== "prisma") {
    console.error(`❌ FINPROOF_REVIEW_STORE="${store}" — 이 스크립트는 prisma(실 DB) 대상에서만 의미가 있습니다.`);
    process.exit(1);
  }

  const { getPrismaClient } = await import("@/server/db/prisma");
  const prisma = getPrismaClient();

  const sources = await prisma.regulatorySource.findMany({
    where: { tenantId, id: { startsWith: MCP_PREFIX } },
    select: { id: true, name: true }
  });

  if (sources.length === 0) {
    console.log(`[cleanup] tenant=${tenantId}: mcp- 소스가 없습니다. 정리할 것이 없습니다.`);
    return;
  }

  const sourceIds = sources.map((s) => s.id);
  const sourceIdSet = new Set(sourceIds);

  const snapshotCount = await prisma.regulatorySnapshot.count({
    where: { tenantId, sourceId: { in: sourceIds } }
  });
  const changeSetCount = await prisma.regulatoryChangeSet.count({
    where: { tenantId, sourceId: { in: sourceIds } }
  });

  console.log(`[cleanup] mode: ${execute ? "EXECUTE (deleting)" : "DRY-RUN (preview only)"}`);
  console.log(`[cleanup] tenant=${tenantId}`);
  console.log(`[cleanup] target mcp- sources: ${sources.length}`);
  console.log(`[cleanup]   ↳ snapshots: ${snapshotCount}, change sets: ${changeSetCount}`);
  for (const s of sources) {
    console.log(`   - ${s.id}  (${s.name})`);
  }

  // Delete children before parents (safe regardless of DB cascade config).
  if (execute) {
    const deletedChangeSets = await prisma.regulatoryChangeSet.deleteMany({
      where: { tenantId, sourceId: { in: sourceIds } }
    });
    const deletedSnapshots = await prisma.regulatorySnapshot.deleteMany({
      where: { tenantId, sourceId: { in: sourceIds } }
    });
    const deletedSources = await prisma.regulatorySource.deleteMany({
      where: { tenantId, id: { startsWith: MCP_PREFIX } }
    });
    console.log(
      `[cleanup] deleted — changeSets:${deletedChangeSets.count} snapshots:${deletedSnapshots.count} sources:${deletedSources.count}`
    );
  }

  const localRemoved = await removeLocalCache(tenantId, sourceIdSet, execute);
  console.log(`[cleanup] local cache files ${execute ? "removed" : "to remove"}: ${localRemoved}`);

  if (!execute) {
    console.log(`\n[cleanup] 미리보기입니다. 실제로 삭제하려면 --execute 를 붙여 다시 실행하세요.`);
  } else {
    console.log(`\n[cleanup] ✅ 검증 아티팩트 정리 완료. 지식문서와 기존 reg-source-knowledge-* 소스는 손대지 않았습니다.`);
  }
}

main().catch((error) => {
  console.error("[cleanup] fatal:", error);
  process.exit(1);
});
