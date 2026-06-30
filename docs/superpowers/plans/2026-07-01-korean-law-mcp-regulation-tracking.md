# Korean-Law-MCP 기반 법령 변경 자동 추적 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** korean-law-mcp(law.go.kr Open API 래퍼) 서버에서 법령 전문을 자동 수집해, 기존 FinProof 변경탐지 엔진(`runSourceCheck`)에 주입함으로써 "사람이 원문을 붙여넣어야만 돌던" 법령 변경 추적을 스케줄 기반 반자동으로 전환한다.

**Architecture:** korean-law-mcp는 LLM 자율 도구가 아니라 **서버 코드가 결정론적으로 호출하는 데이터 페처**로 사용한다(기존 "코드가 근거 수집을 통제한다"는 규제 안전성 원칙 유지). 신규 폴러가 active `RegulatorySource`마다 MCP `get_law_text`로 현행 전문을 가져오고, 직전 폴링 때 저장해 둔 정규화 텍스트를 `previousNormalizedText`로 함께 넘겨 기존 `runSourceCheck`(SHA-256 해시 비교 → 조문 diff → 품질게이트 → 지식문서 자동 버전 생성)를 그대로 재사용한다. 스케줄러는 EC2 배포 환경에 맞춰 `run-analysis-worker.ts`와 동일한 standalone tsx 워커 + systemd timer 패턴으로 구성한다.

**Tech Stack:** TypeScript, Next.js(App Router), Vitest, `@modelcontextprotocol/sdk`(MCP HTTP 클라이언트), tsx, Prisma/mock 듀얼 store, 기존 storage adapter.

**Scope:** 이 계획은 공백 ①(외부 자동 수집)·②(스케줄러)·그리고 ③의 최소 버전(변경 감지 시 audit + 콘솔/슬랙 알림 훅)을 닫는다. 옵션 B(`time_travel`/`amendment_track`로 조문 diff·개정사유를 직접 받아 `interpretationSummary` 강화)와 영향 케이스 자동 재분석 큐잉은 **후속 계획(Phase 2)** 으로 분리한다 — 본 계획만으로도 독립적으로 동작·테스트 가능하다.

---

## 사전 확인된 코드 사실 (구현 시 변경 금지 기준점)

- `createRegulatoryKnowledgeService().runSourceCheck(context, input)` — `src/server/regulatory/regulatory-knowledge-service.ts:202`
  - `input: RunSourceCheckInput`(`:21-35`): `{ sourceId, title, version, sourceText, previousNormalizedText?, previousContentHash?, effectiveFrom?, documentType, productType?, mappedChannels?, mappedReviewCategories?, activateKnowledgeDocument?, baselineOnly? }`
  - 반환 `RunSourceCheckResult`(`:37-43`): `{ sourceId, snapshotCreated, activated, changeSetCount, activatedDocumentIds }`
  - **핵심 제약**: 직전 스냅샷이 존재하면 `previousNormalizedText`가 필수이고 `contentHash(previousNormalizedText)`가 직전 스냅샷의 `contentHash`와 정확히 일치해야 한다(`:235-251`). 불일치 시 `RegulatorySourceCheckInputError` throw → 폴러는 **직전 폴링 때 보낸 sourceText를 바이트 단위로 보존**해야 한다.
- `RegulatorySource` 타입(`src/domain/types.ts:301-314`): `{ id, tenantId, sourceType, name, url?, repositoryPath?, pollingSchedule, trustLevel, lastCheckedAt?, status, createdAt, updatedAt }`. **법령 식별자를 담을 별도 컬럼이 없으므로 `url` 필드에 law.go.kr 식별자를 저장**한다(스키마 마이그레이션 불필요).
- store 메서드(`src/server/reviews/review-store.ts`): `listRegulatorySources`(`:495`), `getRegulatorySource`(`:496`), `createRegulatorySource`(`:491`), `getLatestRegulatorySnapshot`(`:504`).
- 시스템 컨텍스트 생성 패턴: `scripts/seed-knowledge-law-api.ts:208` `reviewerContext()` — `{ tenantId: env.FINPROOF_DEFAULT_TENANT_ID ?? "tenant-demo", userId: env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo", role: "reviewer" }`.
- 워커 루프 패턴: `scripts/run-analysis-worker.ts`(sleep/while/runOnce, `package.json`의 `ops:analysis:worker`).
- `RequestContext` 타입: `src/server/auth/request-context.ts`.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/server/regulatory/korean-law-mcp-client.ts` (신규) | korean-law-mcp HTTP(JSON-RPC) 호출 래퍼. `getLawText()` 하나만 노출(옵션 A). 텍스트·시행일 파싱 포함. |
| `src/server/regulatory/korean-law-mcp-client.test.ts` (신규) | 클라이언트 단위 테스트(전송 mock). |
| `src/server/storage/storage-adapter.ts` (수정) | `putRegulatorySourceText`/`getRegulatorySourceText` 인터페이스 추가. |
| `src/server/storage/local-metadata-storage-adapter.ts` (수정) | 로컬 구현. |
| `src/server/storage/s3-metadata-storage-adapter.ts` (수정) | S3 구현. |
| `src/server/regulatory/regulatory-source-poller.ts` (신규) | 오케스트레이션: active 소스 순회 → MCP fetch → 이전 텍스트 로드 → `runSourceCheck` → 텍스트 저장 → `lastCheckedAt`/알림. |
| `src/server/regulatory/regulatory-source-poller.test.ts` (신규) | 폴러 단위 테스트(MCP 클라이언트·store·storage mock). |
| `scripts/poll-regulatory-sources.ts` (신규) | CLI 진입점(once/loop). `reviewerContext()` 구성. |
| `package.json` (수정) | `ops:regulatory:poll` 스크립트 추가. |
| `docs/ops/regulatory-poller-systemd.md` (신규) | systemd service+timer 설치 문서 + 필요 env. |

---

## Task 1: korean-law-mcp 클라이언트 — get_law_text 래퍼

MCP 서버를 결정론적 데이터 소스로 호출한다. 원격 stateless 엔드포인트(`https://korean-law-mcp.fly.dev/mcp?oc=KEY`) 또는 self-host URL을 env로 받는다. 의존성을 늘리지 않기 위해 **공식 SDK 대신 얇은 JSON-RPC fetch**로 구현하고, 응답의 첫 `text` 컨텐츠 블록을 추출한다.

**Files:**
- Create: `src/server/regulatory/korean-law-mcp-client.ts`
- Test: `src/server/regulatory/korean-law-mcp-client.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/server/regulatory/korean-law-mcp-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { createKoreanLawMcpClient } from "./korean-law-mcp-client";

function mockFetch(jsonRpcResult: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return { jsonrpc: "2.0", id: 1, result: jsonRpcResult };
    }
  }));
}

describe("createKoreanLawMcpClient", () => {
  it("calls tools/call with get_law_text and returns the text content", async () => {
    const fetchImpl = mockFetch({
      content: [{ type: "text", text: "공포일: 2026-01-01\n시행일: 2026-07-01\n[현행]\n제1조 본문" }]
    });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "honggildong" },
      fetchImpl as never
    );

    const result = await client.getLawText({ lawId: "123456" });

    expect(result.text).toContain("제1조 본문");
    expect(result.effectiveFrom).toBe("2026-07-01");

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("get_law_text");
    expect(body.params.arguments.lawId).toBe("123456");
  });

  it("falls back to the public fly.dev endpoint when KOREAN_LAW_MCP_URL is unset", async () => {
    const fetchImpl = mockFetch({ content: [{ type: "text", text: "[현행]\n제1조" }] });
    const client = createKoreanLawMcpClient({ LAW_API_OC: "honggildong" }, fetchImpl as never);

    await client.getLawText({ lawId: "1" });

    const [calledUrl] = fetchImpl.mock.calls[0];
    expect(String(calledUrl)).toContain("korean-law-mcp.fly.dev");
    expect(String(calledUrl)).toContain("oc=honggildong");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/server/regulatory/korean-law-mcp-client.test.ts`
Expected: FAIL — `Cannot find module './korean-law-mcp-client'`

- [ ] **Step 3: 최소 구현 작성**

```ts
// src/server/regulatory/korean-law-mcp-client.ts
type Env = Record<string, string | undefined>;

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{ ok: boolean; status?: number; statusText?: string; json(): Promise<unknown> }>;

export type GetLawTextParams = {
  /** law.go.kr law id 또는 MST 중 하나 */
  lawId?: string;
  mst?: string;
  /** 특정 조문만 필요할 때(옵션) */
  jo?: string;
};

export type GetLawTextResult = {
  text: string;
  effectiveFrom?: string;
  promulgatedAt?: string;
  isCurrent: boolean;
};

export type KoreanLawMcpClient = {
  getLawText(params: GetLawTextParams): Promise<GetLawTextResult>;
};

function envValue(env: Env, key: string): string | undefined {
  const raw = env[key];
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function extractMcpText(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown[] }).content)
  ) {
    for (const part of (result as { content: unknown[] }).content) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type: unknown }).type === "text" &&
        "text" in part &&
        typeof (part as { text: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function parseHeaderDate(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`${label}\\s*[:：]\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})`));
  return match?.[1];
}

export function createKoreanLawMcpClient(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch
): KoreanLawMcpClient {
  const baseUrl =
    envValue(env, "KOREAN_LAW_MCP_URL") ?? "https://korean-law-mcp.fly.dev/mcp";
  const oc = envValue(env, "LAW_API_OC") ?? envValue(env, "LAW_OC");
  const timeoutMs = Number(envValue(env, "KOREAN_LAW_MCP_TIMEOUT_MS") ?? "60000");
  const url = oc ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}oc=${encodeURIComponent(oc)}` : baseUrl;

  return {
    async getLawText(params) {
      const response = await fetchImpl(url, {
        method: "POST",
        signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000),
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "get_law_text",
            arguments: {
              ...(params.lawId ? { lawId: params.lawId } : {}),
              ...(params.mst ? { MST: params.mst } : {}),
              ...(params.jo ? { jo: params.jo } : {})
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(
          `korean-law-mcp get_law_text failed: ${response.status ?? "unknown"} ${
            response.statusText ?? ""
          }`.trim()
        );
      }

      const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) {
        throw new Error(`korean-law-mcp returned error: ${body.error.message ?? "unknown"}`);
      }

      const text = extractMcpText(body.result).trim();
      return {
        text,
        effectiveFrom: parseHeaderDate(text, "시행일"),
        promulgatedAt: parseHeaderDate(text, "공포일"),
        isCurrent: text.includes("[현행]")
      };
    }
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/server/regulatory/korean-law-mcp-client.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋**

```bash
git add src/server/regulatory/korean-law-mcp-client.ts src/server/regulatory/korean-law-mcp-client.test.ts
git commit -m "feat(regulatory): add korean-law-mcp get_law_text client"
```

---

## Task 2: 직전 폴링 텍스트 영속화 — storage adapter 확장

`runSourceCheck`의 해시 round-trip 제약 때문에 폴러는 **직전에 보낸 sourceText를 바이트 그대로** 보관해야 한다. storage adapter에 소스별 텍스트 read/write를 추가한다.

**Files:**
- Modify: `src/server/storage/storage-adapter.ts`
- Modify: `src/server/storage/local-metadata-storage-adapter.ts`
- Modify: `src/server/storage/s3-metadata-storage-adapter.ts`
- Test: `src/server/storage/storage-adapter.test.ts` (기존 파일에 추가)

- [ ] **Step 1: 인터페이스에 메서드 추가 (`storage-adapter.ts`)**

`ReviewStorageAdapter` 타입 정의에 아래 두 시그니처를 추가한다:

```ts
  /** 법령 소스의 직전 정규화 텍스트를 저장한다(폴링 비교용). */
  putRegulatorySourceText(input: { sourceId: string; tenantId: string; text: string }): Promise<void>;
  /** 직전 정규화 텍스트를 반환한다. 없으면 null. */
  getRegulatorySourceText(input: { sourceId: string; tenantId: string }): Promise<string | null>;
```

- [ ] **Step 2: 실패하는 테스트 작성 (`storage-adapter.test.ts`에 추가)**

```ts
import { describe, expect, it } from "vitest";
import { getReviewStorageAdapter } from "./index";

describe("regulatory source text persistence", () => {
  it("round-trips regulatory source text", async () => {
    const adapter = getReviewStorageAdapter();
    const key = { sourceId: "src-test-1", tenantId: "tenant-demo" };

    expect(await adapter.getRegulatorySourceText(key)).toBeNull();

    await adapter.putRegulatorySourceText({ ...key, text: "제1조 본문 v1" });
    expect(await adapter.getRegulatorySourceText(key)).toBe("제1조 본문 v1");

    await adapter.putRegulatorySourceText({ ...key, text: "제1조 본문 v2" });
    expect(await adapter.getRegulatorySourceText(key)).toBe("제1조 본문 v2");
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/server/storage/storage-adapter.test.ts`
Expected: FAIL — `adapter.getRegulatorySourceText is not a function`

- [ ] **Step 4: 로컬 구현 추가 (`local-metadata-storage-adapter.ts`)**

파일 상단 import에 `readFile`이 이미 있는지 확인하고(없으면 `node:fs/promises`에서 `readFile`, `writeFile`, `mkdir` 추가), 반환 객체에 아래를 추가한다. 키는 `regulatory/source-text/<tenantId>/<sourceId>.txt` 규칙을 따른다.

```ts
    async putRegulatorySourceText(input: { sourceId: string; tenantId: string; text: string }): Promise<void> {
      const storageKey = `local/regulatory/source-text/${input.tenantId}/${input.sourceId}.txt`;
      const targetPath = storagePath(rootDir, storageKey);
      if (!targetPath) {
        throw new Error(`Invalid regulatory source text key: ${storageKey}`);
      }
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, input.text, "utf8");
    },
    async getRegulatorySourceText(input: { sourceId: string; tenantId: string }): Promise<string | null> {
      const storageKey = `local/regulatory/source-text/${input.tenantId}/${input.sourceId}.txt`;
      const targetPath = storagePath(rootDir, storageKey);
      if (!targetPath) {
        return null;
      }
      try {
        return await readFile(targetPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
```

- [ ] **Step 5: S3 구현 추가 (`s3-metadata-storage-adapter.ts`)**

기존 S3 클라이언트(`PutObjectCommand`/`GetObjectCommand`/`bucket`)를 재사용해 반환 객체에 추가한다. (해당 파일의 기존 import·변수명을 따른다. `NoSuchKey`/404는 null 처리.)

```ts
    async putRegulatorySourceText(input: { sourceId: string; tenantId: string; text: string }): Promise<void> {
      const key = `regulatory/source-text/${input.tenantId}/${input.sourceId}.txt`;
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: input.text, ContentType: "text/plain; charset=utf-8" })
      );
    },
    async getRegulatorySourceText(input: { sourceId: string; tenantId: string }): Promise<string | null> {
      const key = `regulatory/source-text/${input.tenantId}/${input.sourceId}.txt`;
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return (await result.Body?.transformToString("utf-8")) ?? null;
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === "NoSuchKey" || name === "NotFound") {
          return null;
        }
        throw error;
      }
    },
```

- [ ] **Step 6: 테스트 통과 확인 (로컬 adapter 기준)**

Run: `FINPROOF_STORAGE_DRIVER=local npx vitest run src/server/storage/storage-adapter.test.ts`
Expected: PASS
(참고: 환경변수명이 다르면 기존 테스트 파일 상단의 driver 설정 방식을 따른다. S3 경로는 실 버킷 없이 단위테스트하지 않고 Task 3의 mock으로 검증한다.)

- [ ] **Step 7: 커밋**

```bash
git add src/server/storage/storage-adapter.ts src/server/storage/local-metadata-storage-adapter.ts src/server/storage/s3-metadata-storage-adapter.ts src/server/storage/storage-adapter.test.ts
git commit -m "feat(storage): persist regulatory source text for polling diff"
```

---

## Task 3: 폴러 서비스 — MCP fetch를 runSourceCheck로 연결

active `RegulatorySource` 중 `url`에 법령 식별자가 있고 `status === "active"`인 것을 순회하며 변경을 탐지한다. 첫 폴링이면 `baselineOnly`, 이후엔 직전 텍스트를 비교 기준으로 넘긴다. 성공 시 새 텍스트를 저장한다.

**Files:**
- Create: `src/server/regulatory/regulatory-source-poller.ts`
- Test: `src/server/regulatory/regulatory-source-poller.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/server/regulatory/regulatory-source-poller.test.ts
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@/server/auth/request-context";
import { createRegulatorySourcePoller } from "./regulatory-source-poller";

const context: RequestContext = {
  tenantId: "tenant-demo",
  userId: "user-reviewer-demo",
  role: "reviewer"
} as RequestContext;

function deps(overrides: Record<string, unknown> = {}) {
  const runSourceCheck = vi.fn(async () => ({
    sourceId: "src-1",
    snapshotCreated: true,
    activated: true,
    changeSetCount: 1,
    activatedDocumentIds: ["doc-1"]
  }));
  return {
    runSourceCheck,
    store: {
      listRegulatorySources: vi.fn(async () => [
        {
          id: "src-1",
          tenantId: "tenant-demo",
          sourceType: "law",
          name: "금융소비자보호법",
          url: "lawId=123456",
          pollingSchedule: "0 9 * * *",
          trustLevel: "official",
          status: "active",
          createdAt: "",
          updatedAt: ""
        }
      ]),
      getLatestRegulatorySnapshot: vi.fn(async () => null),
      updateRegulatorySource: vi.fn(async () => undefined),
      recordAuditEvent: vi.fn(async () => undefined)
    },
    storage: {
      getRegulatorySourceText: vi.fn(async () => null),
      putRegulatorySourceText: vi.fn(async () => undefined)
    },
    lawClient: {
      getLawText: vi.fn(async () => ({
        text: "공포일: 2026-01-01\n시행일: 2026-07-01\n[현행]\n제1조 v1",
        effectiveFrom: "2026-07-01",
        isCurrent: true
      }))
    },
    ...overrides
  };
}

describe("createRegulatorySourcePoller", () => {
  it("runs baselineOnly on first poll and stores fetched text", async () => {
    const d = deps();
    const poller = createRegulatorySourcePoller(d as never);

    const summary = await poller.pollAll(context);

    expect(d.lawClient.getLawText).toHaveBeenCalledWith({ lawId: "123456" });
    const checkArg = d.runSourceCheck.mock.calls[0][1];
    expect(checkArg.baselineOnly).toBe(true);
    expect(checkArg.activateKnowledgeDocument).toBe(true);
    expect(checkArg.previousNormalizedText).toBeUndefined();
    expect(d.storage.putRegulatorySourceText).toHaveBeenCalledWith({
      sourceId: "src-1",
      tenantId: "tenant-demo",
      text: "공포일: 2026-01-01\n시행일: 2026-07-01\n[현행]\n제1조 v1"
    });
    expect(summary.checked).toBe(1);
    expect(summary.changed).toBe(1);
  });

  it("passes previous text when a snapshot already exists", async () => {
    const d = deps({
      store: {
        ...deps().store,
        getLatestRegulatorySnapshot: vi.fn(async () => ({ id: "snap-0", contentHash: "x" }))
      },
      storage: {
        getRegulatorySourceText: vi.fn(async () => "제1조 v0"),
        putRegulatorySourceText: vi.fn(async () => undefined)
      }
    });
    const poller = createRegulatorySourcePoller(d as never);

    await poller.pollAll(context);

    const checkArg = d.runSourceCheck.mock.calls[0][1];
    expect(checkArg.baselineOnly).toBe(false);
    expect(checkArg.previousNormalizedText).toBe("제1조 v0");
  });

  it("skips sources without a law identifier and records failure without throwing", async () => {
    const d = deps({
      store: {
        ...deps().store,
        listRegulatorySources: vi.fn(async () => [
          { id: "src-x", tenantId: "tenant-demo", sourceType: "law", name: "no-id", pollingSchedule: "manual", trustLevel: "official", status: "active", createdAt: "", updatedAt: "" }
        ])
      }
    });
    const poller = createRegulatorySourcePoller(d as never);

    const summary = await poller.pollAll(context);

    expect(d.runSourceCheck).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/server/regulatory/regulatory-source-poller.test.ts`
Expected: FAIL — `Cannot find module './regulatory-source-poller'`

- [ ] **Step 3: 최소 구현 작성**

`updateRegulatorySource`가 store 인터페이스에 없을 수 있으므로, 없으면 `recordAuditEvent`만으로 대체하도록 옵셔널 처리한다. `url`에서 식별자를 파싱하는 규칙은 `lawId=<값>` / `mst=<값>` / 접두사 없으면 lawId로 간주.

```ts
// src/server/regulatory/regulatory-source-poller.ts
import type { RequestContext } from "@/server/auth/request-context";
import { getReviewStore } from "@/server/reviews";
import { getReviewStorageAdapter } from "@/server/storage";
import { createRegulatoryKnowledgeService } from "./regulatory-knowledge-service";
import { createKoreanLawMcpClient, type KoreanLawMcpClient } from "./korean-law-mcp-client";

export type RegulatorySourcePollerDeps = {
  runSourceCheck?: ReturnType<typeof createRegulatoryKnowledgeService>["runSourceCheck"];
  store?: {
    listRegulatorySources: (scope: { tenantId: string }) => Promise<unknown[]>;
    getLatestRegulatorySnapshot: (scope: { tenantId: string }, sourceId: string) => Promise<unknown>;
    recordAuditEvent: (scope: { tenantId: string }, event: Record<string, unknown>) => Promise<unknown>;
    updateRegulatorySource?: (scope: { tenantId: string }, id: string, patch: Record<string, unknown>) => Promise<unknown>;
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
      const scope = { tenantId: context.tenantId };
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
          await store.recordAuditEvent(scope, {
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
          await store.recordAuditEvent(scope, {
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
```

> 참고: `documentType: "law"`가 `KnowledgeDocumentType` 유니온에 존재하는지 `src/domain/types.ts`에서 확인하고, 없으면 해당 파일의 실제 law 카테고리 값으로 교체한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/server/regulatory/regulatory-source-poller.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add src/server/regulatory/regulatory-source-poller.ts src/server/regulatory/regulatory-source-poller.test.ts
git commit -m "feat(regulatory): add MCP-driven regulatory source poller"
```

---

## Task 4: CLI 워커 스크립트 + npm script

`run-analysis-worker.ts`와 동일한 once/loop 패턴. systemd가 `--once`로 호출한다.

**Files:**
- Create: `scripts/poll-regulatory-sources.ts`
- Modify: `package.json` (scripts 블록)

- [ ] **Step 1: 스크립트 작성**

```ts
// scripts/poll-regulatory-sources.ts
import "dotenv/config";
import type { RequestContext } from "@/server/auth/request-context";
import { createRegulatorySourcePoller } from "@/server/regulatory/regulatory-source-poller";

function reviewerContext(): RequestContext {
  return {
    tenantId: process.env.FINPROOF_DEFAULT_TENANT_ID ?? "tenant-demo",
    userId: process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo",
    role: "reviewer"
  } as RequestContext;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const loop = args.has("--loop");
  const intervalMs = Number(process.env.FINPROOF_REGULATORY_POLL_INTERVAL_MS ?? "86400000");
  const poller = createRegulatorySourcePoller({
    onChange: (info) =>
      console.log(`[regulatory-poll] CHANGE detected: ${info.name} (${info.changeSetCount} change-set)`)
  });

  do {
    const summary = await poller.pollAll(reviewerContext());
    console.log(`[regulatory-poll] ${JSON.stringify(summary)}`);
    if (loop) {
      await sleep(Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 86_400_000);
    }
  } while (loop);
}

main().catch((error) => {
  console.error("[regulatory-poll] fatal:", error);
  process.exit(1);
});
```

- [ ] **Step 2: package.json에 스크립트 추가**

`"db:seed:knowledge:guides": "tsx scripts/seed-knowledge-guides.ts"` 줄 뒤에 추가(앞 줄 끝 콤마 유지):

```json
    "ops:regulatory:poll": "tsx scripts/poll-regulatory-sources.ts --once",
    "ops:regulatory:poll:loop": "tsx scripts/poll-regulatory-sources.ts --loop"
```

- [ ] **Step 3: 드라이런 — MCP env 없이 graceful 실패 확인**

Run: `npm run ops:regulatory:poll`
Expected: env에 `LAW_API_OC`만 있고 MCP URL 미설정이면 공개 fly.dev 엔드포인트로 폴백해 소스를 순회한다(등록된 active 소스가 없으면 `{checked:0,...}` 출력). 네트워크 차단 환경이면 소스별 `poll_failed` audit 후 정상 종료.

- [ ] **Step 4: 커밋**

```bash
git add scripts/poll-regulatory-sources.ts package.json
git commit -m "feat(regulatory): add regulatory poll CLI worker"
```

---

## Task 5: systemd timer 운영 문서 + 환경변수

EC2(서울 `52.78.86.72`) 배포 환경. Vercel Cron이 아니라 systemd timer가 정석(OCR 서비스 패턴과 동일). 신규 env를 문서화한다.

**Files:**
- Create: `docs/ops/regulatory-poller-systemd.md`

- [ ] **Step 1: 운영 문서 작성**

```markdown
# 법령 변경 추적 폴러 — systemd 설치

## 신규 환경변수 (.env / 배포 env)
- `KOREAN_LAW_MCP_URL` — korean-law-mcp 엔드포인트. **미설정 시 `https://korean-law-mcp.fly.dev/mcp`로 자동 폴백.** 프로덕션은 self-host 권장(예: `http://127.0.0.1:7000/mcp`).
- `LAW_API_OC` — law.go.kr Open API OC 키(open.law.go.kr 무료 발급, 호출 IP 등록 필요). 시드 스크립트와 동일 변수명. (`LAW_OC`도 폴백 지원)
- `KOREAN_LAW_MCP_TIMEOUT_MS` — 선택, 기본 60000.
- `FINPROOF_REGULATORY_POLL_INTERVAL_MS` — `--loop` 모드 간격, 기본 86400000(24h).
- `FINPROOF_DEFAULT_TENANT_ID` / `FINPROOF_DEFAULT_REVIEWER_USER_ID` — 폴러 실행 컨텍스트.

## /etc/systemd/system/finproof-regulatory-poll.service
```ini
[Unit]
Description=FinProof regulatory source poller (korean-law-mcp)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/home/ec2-user/FinProof_Agent
EnvironmentFile=/home/ec2-user/FinProof_Agent/.env
ExecStart=/usr/bin/npm run ops:regulatory:poll
```

## /etc/systemd/system/finproof-regulatory-poll.timer
```ini
[Unit]
Description=Run FinProof regulatory poller daily at 09:00 KST

[Timer]
OnCalendar=*-*-* 09:00:00 Asia/Seoul
Persistent=true

[Install]
WantedBy=timers.target
```

## 설치
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now finproof-regulatory-poll.timer
systemctl list-timers | grep regulatory
sudo systemctl start finproof-regulatory-poll.service   # 1회 수동 실행
journalctl -u finproof-regulatory-poll.service -n 50    # 로그 확인
```

## RegulatorySource 등록 규칙
- `url` 필드에 법령 식별자를 넣는다: `lawId=<id>` 또는 `mst=<MST>` 또는 식별자만(=lawId).
- `status`가 `active`인 소스만 폴링 대상. 일시중지는 `paused`로.
- 첫 폴링은 baseline(스냅샷만 생성, 변경 없음)이고, 두 번째 폴링부터 diff가 발생한다.
```

- [ ] **Step 2: 커밋**

```bash
git add docs/ops/regulatory-poller-systemd.md
git commit -m "docs(ops): regulatory poller systemd timer + env"
```

---

## Task 6: 전체 회귀 확인

- [ ] **Step 1: 관련 테스트 + 타입체크 + 린트**

Run:
```bash
npx vitest run src/server/regulatory src/server/storage
npx tsc --noEmit
npm run lint
```
Expected: 모두 통과(0 errors).

- [ ] **Step 2: 커밋(필요 시 lint 자동수정 반영)**

```bash
git add -A
git commit -m "chore(regulatory): finalize MCP polling integration"
```

---

## Phase 2 (별도 계획 — 본 계획 범위 외, 착수 전 합의)

1. **옵션 B 의미 강화** — `legal_research(task: amendment_track)` / `time_travel` 호출로 신구대조표·제·개정 이유를 받아 `RegulatoryChangeSet.interpretationSummary`에 주입. 이때 비로소 `regulation_update_monitor` LLM 태스크(현재 dead)를 요약 생성에 연결.
2. **영향 케이스 자동 재분석 큐잉** — changeSet의 `mappedProductTypes`/`impactTags`로 영향받는 진행중 케이스를 찾아 재분석 워커에 enqueue.
3. **알림 채널 실연동** — `onChange` 훅을 슬랙/메일로 확장(현재는 콘솔/audit).
4. **관리자 승인 UI** — `RegulatoryWatchDashboard`에 changeSet 승인/반려 액션 추가(현재는 품질게이트 자동판정만).

---

## Self-Review 결과

- **Spec coverage**: 공백 ①(수집)=Task 1·3, ②(스케줄러)=Task 4·5, ③최소(audit/알림 훅)=Task 3 `onChange`+audit. 해시 round-trip 제약=Task 2. ✅
- **Placeholder scan**: 모든 코드 스텝에 실제 코드 포함. 단 두 곳에 명시적 검증 지시(① `documentType:"law"` 유니온 확인, ② storage 테스트 driver 설정)를 남김 — 이는 코드베이스 확인 지시이지 placeholder 아님. ✅
- **Type consistency**: `getLawText({lawId}|{mst})`, `RunSourceCheckInput` 필드명, `PollSummary{checked,changed,skipped,failed}`, storage 메서드명(`put/getRegulatorySourceText`)이 Task 간 일치. ✅
- **알려진 리스크**: `store.updateRegulatorySource`가 실제 인터페이스에 없을 수 있어 옵셔널 처리(없으면 `lastCheckedAt` 갱신 생략, audit는 유지). 실행 시 store에 메서드가 있으면 자동 사용.
