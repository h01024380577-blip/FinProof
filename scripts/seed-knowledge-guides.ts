import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ProductType } from "@/domain/types";
import type { RequestContext } from "@/server/auth/request-context";
import { createReviewService } from "@/server/reviews/review-service";
import { loadDotEnv } from "./load-env";

/**
 * Registers the directly-downloadable *guideline / self-regulation* documents
 * from the "FinProof RAG 지식문서 보강 (딥리서치 2차)" report — the ones whose
 * original text can be fetched and extracted without a login wall. Each is
 * downloaded, converted to plain text (PDF via `pdftotext`, server-rendered
 * pages via tag-stripping) and registered through the real ingestion path.
 *
 * Scope decision (user): 가이드·규정류 원문만. P2 상품설명서·약관과 회원
 * 전용/사망 링크 문서는 제외.
 *
 * Usage:
 *   npm run db:seed:knowledge:guides -- --dry-run
 *   npm run db:seed:knowledge:guides
 *   npm run db:seed:knowledge:guides -- --force
 */

type GuideSource = { kind: "pdf"; url: string } | { kind: "html"; url: string };

type GuideSeedDocument = {
  id: string;
  productType?: ProductType;
  title: string;
  /** Best-known effective/issue date (ISO). */
  effectiveFrom: string;
  source: GuideSource;
};

const guideSeedDocuments: GuideSeedDocument[] = [
  {
    id: "knowledge-guide-online-disclosure",
    title: "온라인 설명의무 가이드라인 (금융위)",
    effectiveFrom: "2022-08-01",
    source: {
      kind: "pdf",
      url: "https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=78276&fileTy=ATTACH&fileNo=6"
    }
  },
  {
    id: "knowledge-guide-kofia-compliance-manual-common",
    productType: "investment",
    title: "금융투자회사 컴플라이언스 매뉴얼 (공통·증권·선물편) — 광고심사",
    effectiveFrom: "2024-12-31",
    source: {
      kind: "html",
      url: "https://law.kofia.or.kr/service/law/lawFullScreenContent.do?seq=284&historySeq=858"
    }
  },
  {
    id: "knowledge-guide-kofia-compliance-manual-asset",
    productType: "investment",
    title: "금융투자회사 컴플라이언스 매뉴얼 (자산운용편) — 펀드광고 심사",
    effectiveFrom: "2024-12-31",
    source: {
      kind: "html",
      url: "https://law.kofia.or.kr/service/law/lawFullScreenContent.do?seq=262&historySeq=1404"
    }
  }
];

type CliOptions = { force: boolean; dryRun: boolean; only?: string };

function parseArgs(argv: string[]): CliOptions {
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  return {
    force: argv.includes("--force"),
    dryRun: argv.includes("--dry-run"),
    only: only && only.length > 0 ? only : undefined
  };
}

function reviewerContext(): RequestContext {
  return {
    tenantId: process.env.FINPROOF_DEFAULT_TENANT_ID ?? "tenant-demo",
    userId: process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo",
    userName: "준법심의 가이드 시드",
    role: "reviewer"
  };
}

async function ensurePrismaPrerequisites(context: RequestContext) {
  const { getPrismaClient } = await import("@/server/db/prisma");
  const prisma = getPrismaClient();
  await prisma.tenant.upsert({
    where: { id: context.tenantId },
    update: {},
    create: { id: context.tenantId, name: "FinProof Demo Tenant" }
  });
  await prisma.user.upsert({
    where: { id: context.userId },
    update: { role: "reviewer", status: "active" },
    create: {
      id: context.userId,
      tenantId: context.tenantId,
      email: "reviewer.demo@finproof.local",
      name: "준법심의자 박민준",
      role: "reviewer"
    }
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pdfToText(buffer: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), "finproof-pdf-"));
  const pdfPath = path.join(dir, "doc.pdf");
  try {
    writeFileSync(pdfPath, buffer);
    const result = spawnSync("pdftotext", ["-enc", "UTF-8", "-nopgbrk", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.status !== 0) {
      throw new Error(`pdftotext 실패: ${result.stderr || result.error?.message || "unknown"}`);
    }
    return result.stdout.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function extract(doc: GuideSeedDocument): Promise<string> {
  const res = await fetch(doc.source.url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`다운로드 실패: HTTP ${res.status}`);
  }
  const heading = `# ${doc.title}\n\n분류: 가이드/자율규제 (원문) · 출처: ${doc.source.url}\n시행/발행: ${doc.effectiveFrom}\n\n`;
  if (doc.source.kind === "pdf") {
    const buffer = Buffer.from(await res.arrayBuffer());
    return heading + pdfToText(buffer);
  }
  return heading + htmlToText(await res.text());
}

async function main() {
  loadDotEnv();
  const options = parseArgs(process.argv.slice(2));

  const store = process.env.FINPROOF_REVIEW_STORE ?? "mock";
  if (store !== "prisma") {
    console.warn(
      `⚠️  FINPROOF_REVIEW_STORE="${store}" — mock 스토어에 기록되며 앱에 보이지 않습니다. prisma 로 설정하세요.`
    );
  }
  if (process.env.FINPROOF_EMBEDDING_PROVIDER === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
    console.error("❌ FINPROOF_EMBEDDING_PROVIDER=openai 인데 OPENAI_API_KEY 가 없습니다.");
    process.exit(1);
  }

  const docs = options.only
    ? guideSeedDocuments.filter((d) => d.title.includes(options.only as string))
    : guideSeedDocuments;

  const context = reviewerContext();
  const service = createReviewService();
  if (store === "prisma" && !options.dryRun) {
    await ensurePrismaPrerequisites(context);
  }

  const existing = new Set((await service.listKnowledgeDocuments(context)).map((d) => d.id));
  const summary = { created: 0, recreated: 0, skipped: 0, failed: 0 };

  for (const doc of docs) {
    const scope = doc.productType ?? "공통";
    const label = `[${scope}] ${doc.title}`;
    const exists = existing.has(doc.id);

    if (exists && !options.force) {
      summary.skipped += 1;
      console.log(`⏭️  skip (exists): ${label}`);
      continue;
    }

    try {
      const text = await extract(doc);
      if (text.length < 300) {
        throw new Error(`추출 텍스트가 너무 짧음 (${text.length}자)`);
      }

      if (options.dryRun) {
        console.log(`📝 plan ${exists ? "recreate" : "create"}: ${label} (${text.length.toLocaleString()}자)`);
        continue;
      }

      if (exists && options.force) {
        await service.deleteKnowledgeDocument(context, doc.id);
      }

      const result = await service.createKnowledgeDocument(context, {
        id: doc.id,
        documentType: "guide",
        productType: doc.productType,
        title: doc.title,
        version: `원문 v${doc.effectiveFrom}`,
        effectiveFrom: doc.effectiveFrom,
        sourceText: text
      });
      await service.approveKnowledgeDocument(context, result.document.id);

      if (exists) summary.recreated += 1;
      else summary.created += 1;
      console.log(
        `✅ ${exists ? "recreated" : "created"} & approved: ${label} ` +
          `(chunks: ${result.ingestion.chunkCount}, ${result.ingestion.embeddingModel})`
      );
    } catch (error) {
      summary.failed += 1;
      console.error(`❌ FAILED: ${label} — ${(error as Error).message}`);
    }
  }

  console.log(
    `\nDone. created=${summary.created} recreated=${summary.recreated} ` +
      `skipped=${summary.skipped} failed=${summary.failed} total=${docs.length}`
  );
  if (options.dryRun) console.log("(dry-run: no changes were written)");
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
