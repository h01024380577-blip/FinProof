# 짧은 광고 RAG 리콜 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 짧은 마케팅 광고에 대해 온-포인트 규정이 후보 풀에 진입하도록 RAG 리콜을 전역 개선한다 (LLM 쿼리 확장 + checklist/guide 전면 편입).

**Architecture:** OCR 추출 광고 텍스트를 검색 전 LLM으로 컴플라이언스 개념어로 확장하고(`expandComplianceQuery`), 확장된 쿼리를 검색·리랭크 양쪽에 사용한다. 동시에 `searchKnowledgeEvidence`의 product_type 스코핑에서 checklist/guide 타입 문서를 항상 후보에 편입한다.

**Tech Stack:** TypeScript, Vitest, Prisma(pg adapter), OpenAI/Gemini via model-router(`ModelProvider.generateText`), pgvector.

**Design:** `docs/superpowers/specs/2026-07-02-short-ad-rag-recall-design.md`

---

### Task 1: `expandComplianceQuery` 모듈

**Files:**
- Create: `src/server/analysis/query-expansion.ts`
- Test: `src/server/analysis/query-expansion.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { expandComplianceQuery } from "./query-expansion";

const modelProvider = (text: string) => ({
  generateText: vi.fn(async () => ({ provider: "openai" as const, model: "gpt", text }))
});

describe("expandComplianceQuery", () => {
  it("returns compliance concept terms for an ad", async () => {
    const provider = modelProvider("한정판매 선착순 희소성 오인유도 마감임박");
    const result = await expandComplianceQuery("긴급특판! 한도 소진 시 조기 종료!", provider);
    expect(result).toContain("한정판매");
    expect(result).toContain("선착순");
  });

  it("returns empty string when the ad text is blank", async () => {
    const provider = modelProvider("무시됨");
    expect(await expandComplianceQuery("   ", provider)).toBe("");
    expect(provider.generateText).not.toHaveBeenCalled();
  });

  it("falls back to empty string when the model call throws", async () => {
    const provider = { generateText: vi.fn(async () => { throw new Error("timeout"); }) };
    expect(await expandComplianceQuery("긴급특판", provider)).toBe("");
  });

  it("falls back to empty string when the model returns nothing usable", async () => {
    const provider = modelProvider("   ");
    expect(await expandComplianceQuery("긴급특판", provider)).toBe("");
  });

  it("normalizes whitespace and strips list punctuation from the model output", async () => {
    const provider = modelProvider("- 한정판매,\n- 선착순 ;  희소성");
    const result = await expandComplianceQuery("긴급특판", provider);
    expect(result).toBe("한정판매 선착순 희소성");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/analysis/query-expansion.test.ts`
Expected: FAIL — `expandComplianceQuery` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { ModelProvider } from "@/server/ai/model-provider";

const INSTRUCTIONS = [
  "당신은 한국 금융광고 준법심의 검색 보조기다.",
  "주어진 광고 문구에 담기거나 암시된 '컴플라이언스 위험 개념'을 규정 검색에 쓰기 좋은 한국어 키워드로만 나열하라.",
  "설명·문장·번호 없이 공백으로 구분된 키워드만 출력한다.",
  "예: 한정판매 선착순 희소성 오인유도 마감임박 압박판매 확정수익 오인 최상급표현 절대적표현"
].join(" ");

const MAX_CONCEPT_CHARS = 400;

/**
 * Expands a short ad into Korean compliance-risk concept keywords so that knowledge
 * retrieval/reranking can bridge the vocabulary gap between marketing copy and formal
 * regulation text (e.g. "한도 소진 조기 종료" → "한정판매 선착순 희소성 오인유도").
 * Best-effort: any failure or unusable output returns "" so the caller keeps the
 * ad-text-only query.
 */
export async function expandComplianceQuery(
  adText: string,
  modelProvider: Pick<ModelProvider, "generateText">
): Promise<string> {
  const trimmed = adText.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const { text } = await modelProvider.generateText({
      task: "retrieval_query",
      instructions: INSTRUCTIONS,
      input: trimmed,
      fallback: ""
    });

    return text
      .replace(/[-•*\d.,:;!?()[\]{}"'`~|\\/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CONCEPT_CHARS);
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/analysis/query-expansion.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/analysis/query-expansion.ts src/server/analysis/query-expansion.test.ts
git commit -m "feat(rag): add expandComplianceQuery for short-ad query expansion"
```

---

### Task 2: `analysisRagQuery`가 개념어를 append하도록 확장

**Files:**
- Modify: `src/server/analysis/review-analysis-pipeline.ts:231-240` (`analysisRagQuery`)
- Test: `src/server/analysis/review-analysis-pipeline.test.ts`

- [ ] **Step 1: Write the failing test** (add inside the existing `describe("review analysis pipeline", ...)` block, after the "excludes placeholder intake metadata …" test)

```typescript
  it("appends expanded compliance concepts to the retrieval and rerank query", async () => {
    const scope: ReviewStoreScope = {
      tenantId: "tenant-demo",
      actorUserId: "user-reviewer-demo",
      actorRole: "reviewer"
    };
    const searchKnowledgeEvidence = vi.fn(async () => []);
    const rerank = vi.fn(async ({ candidates }) => candidates);
    const generateText = vi.fn(async () => ({
      provider: "openai" as const,
      model: "gpt",
      text: "한정판매 선착순 희소성"
    }));
    const pipeline = createReviewAnalysisPipeline({
      reviewStore: { searchKnowledgeEvidence },
      reranker: { provider: "fixture-reranker", rerank },
      modelProvider: { generateText },
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "긴급특판 한도 소진 시 조기 종료",
            confidence: 0.94,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    await pipeline.run({ review, scope });

    expect(searchKnowledgeEvidence).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ query: expect.stringContaining("한정판매 선착순 희소성") })
    );
    expect(rerank).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining("한정판매 선착순 희소성") })
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/analysis/review-analysis-pipeline.test.ts -t "appends expanded compliance concepts"`
Expected: FAIL — query does not contain "한정판매 선착순 희소성" (expansion not wired yet).

- [ ] **Step 3: Modify `analysisRagQuery` to accept optional concepts** (replace lines 231-240)

```typescript
function analysisRagQuery(
  review: ReviewCase,
  documents: ExtractedDocument[],
  conceptTerms = ""
): string {
  const extractedText = documents
    .map((document) => document.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const base = extractedText || reviewRagQuery(review);
  const concepts = conceptTerms.trim();

  return (concepts ? `${base} ${concepts}` : base).slice(0, MAX_RAG_QUERY_CHARS);
}
```

- [ ] **Step 4: Add `queryConcepts` to `RagRetrieveInput`** (modify lines 109-114)

```typescript
type RagRetrieveInput = {
  review: ReviewCase;
  extractedDocuments: ExtractedDocument[];
  scope?: ReviewStoreScope;
  queryConcepts?: string;
};
```

- [ ] **Step 5: Thread concepts through the retriever** (modify lines 1094-1096)

```typescript
    async retrieve({ review, extractedDocuments, scope, queryConcepts }) {
      const searchableDocuments = documentsForAnalysis(extractedDocuments, review);
      const query = analysisRagQuery(review, searchableDocuments, queryConcepts);
```

- [ ] **Step 6: Compute expansion in `run()` and pass to retrieve + rerank** (modify the block at lines ~1615-1628; add import at top and the expansion call)

Add to the import block for `./review-subagents` area (near line 37), a new import line:

```typescript
import { expandComplianceQuery } from "./query-expansion";
```

Then in `run()`, replace the retrieve+rerank section:

```typescript
      const conceptTerms = await expandComplianceQuery(
        analysisDocuments.map((document) => document.text).join(" "),
        modelProvider
      );
      const retrievedCandidates = await ragRetriever.retrieve({
        review,
        extractedDocuments: analysisDocuments,
        scope,
        queryConcepts: conceptTerms
      });
      // Rerank with the same expanded, OCR-enriched query used for retrieval.
      const rerankedCandidates = await reranker.rerank({
        query: analysisRagQuery(review, analysisDocuments, conceptTerms),
        candidates: retrievedCandidates
      });
```

- [ ] **Step 7: Run the new test + full analysis suite**

Run: `npx vitest run src/server/analysis/`
Expected: PASS — new test passes, all prior tests (99 total) still green.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "review-analysis-pipeline\|query-expansion" || echo clean`
Expected: `clean`

- [ ] **Step 9: Commit**

```bash
git add src/server/analysis/review-analysis-pipeline.ts src/server/analysis/review-analysis-pipeline.test.ts
git commit -m "feat(rag): wire compliance query expansion into retrieval and rerank"
```

---

### Task 3: checklist/guide 문서 전면 편입 (B-ii)

**Files:**
- Modify: `src/server/reviews/prisma-review-store.ts:1054-1059` (vector SQL productType filter)
- Modify: `src/server/reviews/prisma-review-store.ts:1151-1155` (Prisma lexical productType filter)
- Test: `src/server/reviews/prisma-review-store.test.ts` (or the nearest existing store test file — confirm with `ls src/server/reviews/*.test.ts`)

- [ ] **Step 1: Confirm the store test file exists**

Run: `ls src/server/reviews/*.test.ts`
Expected: a test file such as `prisma-review-store.test.ts`. If none tests `searchKnowledgeEvidence` with a productType filter, add the test below to the closest store test file; otherwise create `src/server/reviews/knowledge-evidence-scoping.test.ts`.

- [ ] **Step 2: Write the failing test**

Add a test asserting the lexical (Prisma) branch admits a `checklist` document whose `product_type` does NOT match the query's productType. Model it on existing `searchKnowledgeEvidence` tests in the file (reuse their harness/fixtures). The assertion:

```typescript
it("includes checklist/guide documents even when product_type does not match", async () => {
  // Given: a knowledge document of type 'checklist' with product_type 'deposit'
  //        and a search with productType 'card' (mismatch)
  // When: searchKnowledgeEvidence runs (no queryEmbedding → lexical branch)
  // Then: the deposit checklist appears in results despite the product_type mismatch.
  const results = await store.searchKnowledgeEvidence(scope, {
    query: "한정판매 선착순 광고",
    productType: "card",
    topK: 10
  });
  expect(results.map((r) => r.documentId)).toContain("knowledge-checklist-deposit");
});
```

> Note: match the fixture seeding style already used in the file. If the file seeds via a mock/in-memory Prisma, seed one `checklist`/`deposit` document + one active chunk. If the suite hits a real test DB, follow its existing seed helpers.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/server/reviews/ -t "includes checklist/guide documents even when product_type"`
Expected: FAIL — the deposit checklist is filtered out by the `product_type = 'card' OR product_type IS NULL` clause.

- [ ] **Step 4: Modify the vector SQL filter** (lines 1054-1059)

```typescript
        if (input.productType) {
          params.push(input.productType);
          whereParts.push(
            `(kd."product_type" = $${params.length}::"ProductType" OR kd."product_type" IS NULL OR kd."document_type" IN ('checklist', 'guide'))`
          );
        }
```

- [ ] **Step 5: Modify the Prisma lexical filter** (lines 1151-1155)

```typescript
      if (input.productType) {
        documentFilters.push({
          OR: [
            { productType: input.productType },
            { productType: null },
            { documentType: { in: ["checklist", "guide"] } }
          ]
        });
      }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/server/reviews/ -t "includes checklist/guide documents even when product_type"`
Expected: PASS.

- [ ] **Step 7: Run the store suite + typecheck**

Run: `npx vitest run src/server/reviews/ && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "prisma-review-store" || echo clean`
Expected: store tests green; `clean`.

- [ ] **Step 8: Commit**

```bash
git add src/server/reviews/prisma-review-store.ts src/server/reviews/*.test.ts
git commit -m "feat(rag): always include checklist/guide docs in knowledge retrieval scope"
```

---

### Task 4: 비파괴 A/B 검증 (배포 전)

**Files:**
- Create (임시): `scripts/verify-expansion.ts`

- [ ] **Step 1: Write a throwaway verification script**

```typescript
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createEmbeddingProvider } from "@/server/knowledge/embedding-provider";
import { createCohereReranker } from "@/server/analysis/rerank-provider";
import { expandComplianceQuery } from "@/server/analysis/query-expansion";
import { createModelProvider } from "@/server/ai/model-provider";

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }) });
  const ad = "긴급특판! 500억 한도! 연5.5% 한도 소진 시 조기 종료! 지금 들어오셔서 상담받으세요.";
  const concepts = await expandComplianceQuery(ad, createModelProvider());
  console.log("개념어:", concepts);
  const emb = createEmbeddingProvider();
  for (const [label, q] of [["ad-only", ad], ["ad+concepts", `${ad} ${concepts}`]] as [string, string][]) {
    const [qv] = await emb.embed([q]);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT kd.id doc, GREATEST(0,1-(ec.embedding_vector <=> $1::vector)) cos
       FROM evidence_chunks ec JOIN knowledge_documents kd ON kd.id=ec.knowledge_document_id
       WHERE ec.knowledge_document_id IS NOT NULL AND kd.approval_status='approved'
         AND (kd.product_type IS NULL OR kd.document_type IN ('checklist','guide'))
       ORDER BY ec.embedding_vector <=> $1::vector LIMIT 6`, `[${qv.join(",")}]`) as any[];
    console.log(`\n[${label}] top6:`);
    for (const r of rows) console.log(`  cos=${Number(r.cos).toFixed(3)} ${r.doc}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/verify-expansion.ts 2>&1 | grep -v "    at "`
Expected: with `ad+concepts`, an on-point checklist/guide (e.g. `knowledge-checklist-common` or `knowledge-checklist-deposit`) rises toward/above the 0.4 floor and ranks above off-target regs. If it does NOT improve, STOP and revisit the expansion prompt before deploying.

- [ ] **Step 3: Remove the throwaway script**

```bash
rm -f scripts/verify-expansion.ts
```

---

### Task 5: 배포 & 프로덕션 재분석 검증

- [ ] **Step 1: Push branch to personal remote**

```bash
git push personal fix-rag-short-ad-recall
```

- [ ] **Step 2: Create and push deploy tag**

```bash
git tag -a deploy-20260702-rag-short-ad-recall -m "Deploy: short-ad RAG recall (query expansion + checklist scoping)"
git push personal deploy-20260702-rag-short-ad-recall
```

- [ ] **Step 3: Watch the deploy**

Run: `gh run list --repo h01024380577-blip/FinProof --workflow deploy-ec2.yml --limit 1 --json databaseId,status` then `gh run watch <id> --repo h01024380577-blip/FinProof --exit-status`
Expected: conclusion `success`.

- [ ] **Step 4: Reset + re-analyze rc-upload-001 and rc-upload-002**

Reset status to `submitted` via tsx against prod DB, then POST for each:
```bash
curl -sS -X POST "https://finproof.duckdns.org/api/v1/review-cases/<id>/analysis/start" \
  -H "x-finproof-role: reviewer" -H "x-finproof-tenant-id: tenant-demo" -H "content-type: application/json"
```
Poll `analysis_jobs` until both `completed`.

- [ ] **Step 5: Verify evidence**

Query per-issue `evidence.source_type` for both cases.
Expected:
- rc-upload-001: **회귀 없음** — 6/6 이슈에 지식근거(law/internal_policy) 유지.
- rc-upload-002: 온-포인트 체크리스트/가이드가 최소 1개 이슈 이상에 부착(개선). 개선이 없으면 확장 프롬프트/floor를 재검토.

---

## Self-Review

- **Spec coverage:** B-i(쿼리 확장)=Task 1-2, B-ii(스코핑)=Task 3, 비파괴 A/B=Task 4, 배포·검증=Task 5. 폴백/오류처리=Task 1(3 tests). 회귀 가드=Task 2 Step 7 + Task 5 Step 5. ✅
- **Placeholder scan:** Task 3 Step 2 테스트 하네스는 파일별 시딩 스타일에 맞추라는 조건부 지시 — 실제 store 테스트 파일 확인 후 확정(스텝에 명시). 그 외 플레이스홀더 없음.
- **Type consistency:** `expandComplianceQuery(adText, modelProvider) → Promise<string>`, `analysisRagQuery(review, documents, conceptTerms?)`, `RagRetrieveInput.queryConcepts?`, `generateText({task,instructions,input,fallback})→{text}` — Task 간 일관.
