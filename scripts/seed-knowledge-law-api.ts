import { pathToFileURL } from "node:url";
import type { KnowledgeDocumentType, ProductType } from "@/domain/types";
import type { RequestContext } from "@/server/auth/request-context";
import { createReviewService } from "@/server/reviews/review-service";
import { loadDotEnv } from "./load-env";

/**
 * Collects the *original text* of the financial-advertising compliance laws,
 * decrees, supervisory regulations and review guidelines listed in the
 * "FinProof RAG 지식문서 보강 (딥리서치 2차)" report, straight from the
 * 국가법령정보 공동활용 Open API (open.law.go.kr / law.go.kr DRF), and
 * registers them as approved knowledge documents through the real ingestion
 * path (text → chunk → embedding), exactly like `seed-knowledge-documents.ts`.
 *
 * Each entry is resolved by official name to its **current in-force version**
 * (현행) via lawSearch, then the full 조문 body is fetched via lawService.
 *
 * Usage:
 *   npm run db:seed:knowledge:law -- --dry-run     # resolve + show plan only
 *   npm run db:seed:knowledge:law                  # create missing
 *   npm run db:seed:knowledge:law -- --force       # delete + recreate all
 *   npm run db:seed:knowledge:law -- --only=금융투자  # filter by title substring
 *
 * Requires:
 *   LAW_API_OC                — open.law.go.kr OC (registered to caller IP)
 *   FINPROOF_REVIEW_STORE=prisma + reachable Postgres (to persist)
 *   OPENAI_API_KEY            — when FINPROOF_EMBEDDING_PROVIDER=openai
 */

type LawSource =
  | { target: "law"; name: string }
  | { target: "admrul"; name: string };

type LawSeedDocument = {
  id: string;
  documentType: KnowledgeDocumentType;
  productType?: ProductType;
  title: string;
  source: LawSource;
};

/** P0/P1 legal documents that are resolvable through the law.go.kr Open API. */
const lawSeedDocuments: LawSeedDocument[] = [
  // ── 공통 법령 ────────────────────────────────────────────────────────
  {
    id: "knowledge-law-fcpa-enforcement-decree",
    documentType: "law",
    title: "금융소비자 보호에 관한 법률 시행령 — 광고 세부기준",
    source: { target: "law", name: "금융소비자 보호에 관한 법률 시행령" }
  },
  {
    id: "knowledge-law-fcpa-supervisory-regulation",
    documentType: "law",
    title: "금융소비자 보호에 관한 감독규정",
    source: { target: "admrul", name: "금융소비자 보호에 관한 감독규정" }
  },
  {
    id: "knowledge-law-fcpa-supervisory-rule",
    documentType: "law",
    title: "금융소비자 보호에 관한 감독규정 시행세칙",
    source: { target: "admrul", name: "금융소비자 보호에 관한 감독규정 시행세칙" }
  },
  {
    id: "knowledge-law-fair-labeling-act-decree",
    documentType: "law",
    title: "표시·광고의 공정화에 관한 법률 시행령",
    source: { target: "law", name: "표시ㆍ광고의 공정화에 관한 법률 시행령" }
  },
  {
    id: "knowledge-law-endorsement-review-guideline",
    documentType: "law",
    title: "추천·보증 등에 관한 표시·광고 심사지침",
    source: { target: "admrul", name: "추천ㆍ보증 등에 관한 표시ㆍ광고 심사지침" }
  },
  {
    id: "knowledge-law-broadcast-ad-review-regulation",
    documentType: "law",
    title: "방송광고심의에 관한 규정",
    source: { target: "admrul", name: "방송광고심의에 관한 규정" }
  },
  {
    id: "knowledge-law-product-sales-broadcast-review",
    documentType: "law",
    title: "상품소개 및 판매방송 심의에 관한 규정",
    source: { target: "admrul", name: "상품소개 및 판매방송 심의에 관한 규정" }
  },
  // ── 보험 ─────────────────────────────────────────────────────────────
  {
    id: "knowledge-law-insurance-act-decree",
    documentType: "law",
    productType: "insurance",
    title: "보험업법 시행령 — 보험광고·모집 기준",
    source: { target: "law", name: "보험업법 시행령" }
  },
  {
    id: "knowledge-law-insurance-supervisory-regulation",
    documentType: "law",
    productType: "insurance",
    title: "보험업감독규정",
    source: { target: "admrul", name: "보험업감독규정" }
  },
  {
    id: "knowledge-law-insurance-supervisory-rule",
    documentType: "law",
    productType: "insurance",
    title: "보험업감독업무시행세칙",
    source: { target: "admrul", name: "보험업감독업무시행세칙" }
  },
  // ── 여신/카드 ────────────────────────────────────────────────────────
  {
    id: "knowledge-law-credit-finance-act-full",
    documentType: "law",
    productType: "card",
    title: "여신전문금융업법 (원문)",
    source: { target: "law", name: "여신전문금융업법" }
  },
  {
    id: "knowledge-law-credit-finance-act-decree",
    documentType: "law",
    productType: "card",
    title: "여신전문금융업법 시행령",
    source: { target: "law", name: "여신전문금융업법 시행령" }
  },
  // ── 은행/예금 ────────────────────────────────────────────────────────
  {
    id: "knowledge-law-banking-act-decree",
    documentType: "law",
    productType: "deposit",
    title: "은행법 시행령",
    source: { target: "law", name: "은행법 시행령" }
  },
  {
    id: "knowledge-law-banking-supervisory-regulation",
    documentType: "law",
    productType: "deposit",
    title: "은행업감독규정",
    source: { target: "admrul", name: "은행업감독규정" }
  },
  // ── 금융투자 ─────────────────────────────────────────────────────────
  {
    id: "knowledge-law-capital-markets-act-full",
    documentType: "law",
    productType: "investment",
    title: "자본시장과 금융투자업에 관한 법률 — 투자광고·투자권유",
    source: { target: "law", name: "자본시장과 금융투자업에 관한 법률" }
  },
  {
    id: "knowledge-law-capital-markets-act-decree",
    documentType: "law",
    productType: "investment",
    title: "자본시장과 금융투자업에 관한 법률 시행령",
    source: { target: "law", name: "자본시장과 금융투자업에 관한 법률 시행령" }
  },
  {
    id: "knowledge-law-financial-investment-regulation",
    documentType: "law",
    productType: "investment",
    title: "금융투자업규정 — 투자광고 심사기준",
    source: { target: "admrul", name: "금융투자업규정" }
  },
  {
    id: "knowledge-law-financial-investment-rule",
    documentType: "law",
    productType: "investment",
    title: "금융투자업규정시행세칙",
    source: { target: "admrul", name: "금융투자업규정시행세칙" }
  },
  // ── 대부 ─────────────────────────────────────────────────────────────
  {
    id: "knowledge-law-loan-business-act-full",
    documentType: "law",
    productType: "loan",
    title: "대부업 등의 등록 및 금융이용자 보호에 관한 법률",
    source: { target: "law", name: "대부업 등의 등록 및 금융이용자 보호에 관한 법률" }
  },
  {
    id: "knowledge-law-loan-business-act-decree",
    documentType: "law",
    productType: "loan",
    title: "대부업 등의 등록 및 금융이용자 보호에 관한 법률 시행령",
    source: { target: "law", name: "대부업 등의 등록 및 금융이용자 보호에 관한 법률 시행령" }
  },
  // ── 저축은행 ─────────────────────────────────────────────────────────
  {
    id: "knowledge-law-mutual-savings-bank-act",
    documentType: "law",
    productType: "deposit",
    title: "상호저축은행법",
    source: { target: "law", name: "상호저축은행법" }
  }
];

type CliOptions = {
  force: boolean;
  dryRun: boolean;
  only?: string;
};

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
    userName: "준법심의 법령 시드(Open API)",
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

const DRF = "https://www.law.go.kr/DRF";

/** Collapse spaces and unify middle-dot variants for name matching. */
function normalizeName(value: string): string {
  return value
    .replace(/[ㆍ·・]/g, "·")
    .replace(/\s+/g, "")
    .trim();
}

/** YYYYMMDD → YYYY-MM-DD (falls back to today on bad input). */
function isoDate(yyyymmdd: string | undefined): string {
  if (yyyymmdd && /^\d{8}$/.test(yyyymmdd)) {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  }
  return new Date().toISOString().slice(0, 10);
}

type Resolved = { mstOrId: string; officialName: string; effectiveDate: string };

async function resolve(oc: string, source: LawSource): Promise<Resolved> {
  const params = new URLSearchParams({
    OC: oc,
    target: source.target,
    query: source.name,
    type: "JSON",
    display: "30"
  });
  const res = await fetch(`${DRF}/lawSearch.do?${params}`);
  const json = (await res.json()) as Record<string, unknown>;
  const root = (json.LawSearch ?? json.AdmRulSearch ?? json) as Record<string, unknown>;
  const rawItems = source.target === "law" ? root.law : root.admrul;
  const items = (Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []) as Array<
    Record<string, string>
  >;

  const wanted = normalizeName(source.name);
  const exact = items.filter(
    (it) => normalizeName(it.법령명한글 ?? it.행정규칙명 ?? "") === wanted
  );
  const pool = exact.length > 0 ? exact : items;
  if (pool.length === 0) {
    throw new Error(`이름으로 해석 실패: "${source.name}" (검색 결과 ${items.length}건)`);
  }
  // Latest effective date wins (current in-force version).
  pool.sort((a, b) =>
    (b.시행일자 ?? b.발령일자 ?? "").localeCompare(a.시행일자 ?? a.발령일자 ?? "")
  );
  const top = pool[0];
  const mstOrId =
    source.target === "law" ? top.법령일련번호 : top.행정규칙일련번호 ?? top.행정규칙ID;
  if (!mstOrId) {
    throw new Error(`일련번호 없음: "${source.name}"`);
  }
  return {
    mstOrId,
    officialName: (top.법령명한글 ?? top.행정규칙명 ?? source.name).trim(),
    effectiveDate: isoDate(top.시행일자 ?? top.발령일자)
  };
}

/** Recursively collect ordered 조문/항/호/목 content strings from a law unit. */
function collectClauses(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectClauses(item, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const key of ["조문내용", "항내용", "호내용", "목내용"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) {
        const line = v.replace(/\s+\n/g, "\n").trim();
        if (out[out.length - 1] !== line) out.push(line);
      }
    }
    for (const key of ["항", "호", "목"]) {
      if (key in obj) collectClauses(obj[key], out);
    }
  }
}

async function fetchText(
  oc: string,
  source: LawSource,
  mstOrId: string
): Promise<{ text: string; effectiveDate: string; officialName: string }> {
  const params = new URLSearchParams({ OC: oc, target: source.target, type: "JSON" });
  if (source.target === "law") params.set("MST", mstOrId);
  else params.set("ID", mstOrId);

  const res = await fetch(`${DRF}/lawService.do?${params}`);
  const json = (await res.json()) as Record<string, unknown>;

  if (typeof json.result === "string") {
    throw new Error(`API 오류: ${json.result} ${json.msg ?? ""}`);
  }

  const out: string[] = [];
  let officialName = "";
  let effectiveDate = "";

  if (source.target === "law") {
    const body = json.법령 as Record<string, unknown> | undefined;
    const info = (body?.기본정보 ?? {}) as Record<string, string>;
    officialName = (info.법령명_한글 ?? info.법령명한글 ?? "").trim();
    effectiveDate = isoDate(info.시행일자);
    const 조문 = (body?.조문 as Record<string, unknown> | undefined)?.조문단위;
    collectClauses(조문, out);
  } else {
    const body = json.AdmRulService as Record<string, unknown> | undefined;
    const info = (body?.행정규칙기본정보 ?? {}) as Record<string, string>;
    officialName = (info.행정규칙명 ?? "").trim();
    effectiveDate = isoDate(info.시행일자);
    const content = body?.조문내용;
    if (Array.isArray(content)) {
      for (const line of content) {
        if (typeof line === "string" && line.trim()) out.push(line.trim());
      }
    } else if (typeof content === "string" && content.trim()) {
      // Some 행정규칙 return the whole body as one string; split on 조 markers
      // for slightly better chunk boundaries.
      out.push(content.replace(/(제\d+(?:-\d+)?조)/g, "\n$1").trim());
    } else {
      collectClauses((body?.조문 as Record<string, unknown> | undefined)?.조문단위, out);
    }
  }

  const heading = `# ${officialName}\n\n분류: 법령/행정규칙 (원문) · 출처: 국가법령정보 공동활용 Open API (law.go.kr)\n시행일: ${effectiveDate}\n`;
  const text = `${heading}\n${out.join("\n")}`.trim();
  return { text, effectiveDate, officialName };
}

async function main() {
  loadDotEnv();
  const options = parseArgs(process.argv.slice(2));

  const oc = process.env.LAW_API_OC?.trim();
  if (!oc) {
    console.error("❌ LAW_API_OC 가 설정되지 않았습니다 (.env 또는 환경변수).");
    process.exit(1);
  }

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
    ? lawSeedDocuments.filter((d) => d.title.includes(options.only as string))
    : lawSeedDocuments;

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
      const resolved = await resolve(oc, doc.source);
      const { text, effectiveDate, officialName } = await fetchText(
        oc,
        doc.source,
        resolved.mstOrId
      );
      if (text.length < 200) {
        throw new Error(`본문이 비정상적으로 짧음 (${text.length}자) — 해석 오류 가능`);
      }

      if (options.dryRun) {
        console.log(
          `📝 plan ${exists ? "recreate" : "create"}: ${label}\n` +
            `     → ${officialName} (시행 ${effectiveDate}, ${text.length.toLocaleString()}자, ` +
            `${doc.source.target}/${resolved.mstOrId})`
        );
        continue;
      }

      if (exists && options.force) {
        await service.deleteKnowledgeDocument(context, doc.id);
      }

      const result = await service.createKnowledgeDocument(context, {
        id: doc.id,
        documentType: doc.documentType,
        productType: doc.productType,
        title: doc.title,
        version: `원문 v${effectiveDate}`,
        effectiveFrom: effectiveDate,
        sourceText: text
      });
      await service.approveKnowledgeDocument(context, result.document.id);

      if (exists) summary.recreated += 1;
      else summary.created += 1;
      console.log(
        `✅ ${exists ? "recreated" : "created"} & approved: ${label} ` +
          `(시행 ${effectiveDate}, chunks: ${result.ingestion.chunkCount}, ${result.ingestion.embeddingModel})`
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
