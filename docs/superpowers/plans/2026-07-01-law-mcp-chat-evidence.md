# 추가 근거 채팅 — 법령 MCP 조건부 보강 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 추가 근거 채팅에서 "관련 법을 검색해 달라"는 의도가 감지되고 등록된 지식문서로는 답을 커버할 수 없을 때만 korean-law-mcp 서버를 호출해 법령 원문 근거를 보강하고, MCP 조회 중에는 어떤 MCP 도구로 무엇을 검색 중인지 진행상황을 채팅 UI에 실시간 표시한다.

**Architecture:** 채팅 POST 라우트를 단일 JSON 응답에서 **NDJSON 스트리밍**으로 전환한다. 서버는 `analyzing_intent → searching_knowledge → (knowledge_hit | knowledge_miss → mcp_search_law → mcp_get_law_text) → generating_answer → done` 순서로 진행 이벤트를 흘려보낸다. MCP 호출은 **2-게이트**(① 법령검색 의도 ② 지식문서 미커버)를 모두 통과할 때만 발생하며, 통과하지 못하면 기존 RAG 근거만으로 답변한다. 의도 판별은 **정규식 프리필터 + 애매 시 LLM 분류**의 2단계다.

**Tech Stack:** Next.js App Router (Route Handler, `ReadableStream`/NDJSON), TypeScript, Vitest, 기존 `createKoreanLawMcpClient`(JSON-RPC HTTP), 기존 `createModelProvider` 라우터.

---

## File Structure

**신규 파일**
- `src/server/ai/law-search-intent.ts` — 정규식 프리필터 + LLM 폴백 의도 분류
- `src/server/ai/law-search-intent.test.ts`
- `src/server/ai/law-coverage.ts` — 법령명 추출 + 지식문서 커버리지 판정(순수 함수)
- `src/server/ai/law-coverage.test.ts`
- `src/server/reviews/mcp-law-evidence.ts` — MCP 법령 응답 → `Evidence` 매핑(순수 함수)
- `src/server/reviews/mcp-law-evidence.test.ts`
- `src/server/reviews/review-chat-stream.ts` — 진행 이벤트 제너레이터 + NDJSON 스트림 헬퍼
- `src/server/reviews/review-chat-stream.test.ts`

**수정 파일**
- `src/domain/chat.ts` — `ChatProgressEvent` 타입 + `chatProgressLabel()` 헬퍼 추가
- `src/domain/chat.test.ts` — `chatProgressLabel` 테스트 (없으면 신규)
- `src/server/ai/prompt-registry.ts` — `LAW_SEARCH_INTENT_PROMPT` 추가, `RAG_CHAT_PROMPT`에 법령원문 우선 규칙 추가
- `src/server/ai/prompt-registry.test.ts` — 위 프롬프트 규칙 테스트
- `src/server/ai/review-ai-service.ts` — `authoritativeLawEvidence` 입력 축 추가
- `src/server/ai/review-ai-service.test.ts` — 법령원문 주입 테스트
- `src/app/api/v1/review-cases/[caseId]/chat/route.ts` — NDJSON 스트림으로 전환, 스트림 제너레이터 배선
- `src/server/regulatory/korean-law-mcp-client.ts` — (기존 그대로 재사용, 수정 없음)
- `src/components/ReviewDetailWorkspace.tsx` — 스트림 파싱 + 진행상황 표시 UI

---

## Task 1: 법령 원문 근거 축(`authoritativeLawEvidence`) — 서비스/프롬프트

MCP가 실제로 붙기 전에, LLM이 법령 원문을 별도 근거로 받아 인용하도록 하는 계약을 먼저 만든다.

**Files:**
- Modify: `src/server/ai/prompt-registry.ts:58-90` (RAG_CHAT_PROMPT), 파일 끝에 `LAW_SEARCH_INTENT_PROMPT` 추가
- Modify: `src/server/ai/review-ai-service.ts:17-26` (입력 타입), `:119-142` (본문)
- Test: `src/server/ai/review-ai-service.test.ts`, `src/server/ai/prompt-registry.test.ts`

- [ ] **Step 1: review-ai-service 실패 테스트 작성**

`src/server/ai/review-ai-service.test.ts`의 `describe("review AI service", ...)` 안에 추가:

```ts
  it("injects authoritative law evidence as a separate prompt axis", async () => {
    const provider = modelProvider("법령 원문 기반 답변");
    await answerReviewQuestionWithModel(
      {
        review,
        issue,
        question: "전자금융거래법 관련 조항 찾아줘",
        knowledgeEvidence: [],
        authoritativeLawEvidence: [
          {
            id: "law-mcp-123456",
            sourceType: "law",
            title: "전자금융거래법",
            quoteSummary: "제1조 목적 ...",
            relevanceScore: 0.9,
            effectiveFrom: "2026-07-01",
            section: "[현행]"
          }
        ]
      },
      provider
    );

    const call = vi.mocked(provider.generateText).mock.calls[0]?.[0];
    expect(call?.input).toContain("authoritativeLawEvidence");
    expect(call?.input).toContain("전자금융거래법");
    expect(call?.instructions).toContain("authoritativeLawEvidence");
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/server/ai/review-ai-service.test.ts -t "authoritative law evidence"`
Expected: FAIL — `authoritativeLawEvidence`가 `AnswerQuestionInput`에 없어 타입/런타임 불일치, `input`에 문자열 없음.

- [ ] **Step 3: review-ai-service 구현**

`src/server/ai/review-ai-service.ts` 입력 타입(`:17-26`)에 필드 추가:

```ts
type AnswerQuestionInput = {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
  knowledgeEvidence?: Evidence[];
  authoritativeLawEvidence?: Evidence[];
  history?: Array<{
    question: string;
    answer: string;
  }>;
};
```

`answerReviewQuestionWithModel` 본문(`:123-142`)을 교체:

```ts
  const evidence = mergeEvidence(input.issue.evidence, [
    ...(input.knowledgeEvidence ?? []),
    ...(input.authoritativeLawEvidence ?? [])
  ]);
  const issueWithKnowledgeEvidence = { ...input.issue, evidence };
  const fallback = answerReviewQuestion({ ...input, issue: issueWithKnowledgeEvidence });
  const result = await provider.generateText({
    task: "rag_chat",
    routeContext: {
      riskLevel: input.issue.riskLevel,
      ...(questionNeedsLegalInterpretation(input.question) ? { legalInterpretation: true } : {})
    },
    instructions: RAG_CHAT_PROMPT,
    input: JSON.stringify({
      review: reviewSummary(input.review),
      issue: issueWithKnowledgeEvidence,
      authoritativeLawEvidence: input.authoritativeLawEvidence ?? [],
      approvedKnowledgeEvidence: input.knowledgeEvidence ?? [],
      question: input.question,
      conversationHistory: input.history ?? [],
      fallback: fallback.content
    }),
    fallback: fallback.content
  });
```

- [ ] **Step 4: prompt-registry 실패 테스트 작성**

`src/server/ai/prompt-registry.test.ts`에 추가:

```ts
import { LAW_SEARCH_INTENT_PROMPT, RAG_CHAT_PROMPT } from "./prompt-registry";

describe("law MCP prompt additions", () => {
  it("RAG_CHAT_PROMPT prioritizes authoritative law evidence", () => {
    expect(RAG_CHAT_PROMPT).toContain("authoritativeLawEvidence");
    expect(RAG_CHAT_PROMPT).toContain("시행일");
  });

  it("LAW_SEARCH_INTENT_PROMPT returns a single classification token", () => {
    expect(LAW_SEARCH_INTENT_PROMPT).toContain("LAW_SEARCH");
    expect(LAW_SEARCH_INTENT_PROMPT).toContain("NONE");
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `npx vitest run src/server/ai/prompt-registry.test.ts -t "law MCP prompt additions"`
Expected: FAIL — 문자열/export 부재.

- [ ] **Step 6: prompt-registry 구현**

`RAG_CHAT_PROMPT`의 입력 목록(`:60-65`) 중 `- approvedKnowledgeEvidence,` 바로 위에 한 줄 추가:

```
- authoritativeLawEvidence (verified statute text retrieved live from the national law database),
```

그리고 `RAG_CHAT_PROMPT`의 인용 규칙 문단(`:69` "When approvedKnowledgeEvidence is relevant ..." 문장) 바로 앞에 다음 문단을 삽입:

```
Treat authoritativeLawEvidence as the most authoritative source. When authoritativeLawEvidence conflicts with other evidence, prefer authoritativeLawEvidence. When you cite it, state its 시행일 and whether it is 현행(current) using the supplied effectiveFrom and section fields. If authoritativeLawEvidence is empty, do not claim you looked up the law.
```

파일 끝(마지막 `export` 뒤)에 새 프롬프트 추가:

```ts
export const LAW_SEARCH_INTENT_PROMPT = `You classify whether a Korean financial advertising reviewer's question is explicitly asking to search for or look up a specific law, statute, article, or regulation.

Return exactly one token and nothing else:
- "LAW_SEARCH" when the reviewer asks to find, look up, cite, or identify a specific law, article, or regulation. Examples: "전자금융거래법에서 관련 조항 찾아줘", "이 문구 근거 법령이 뭐야", "무슨 법 위반인지 법령 찾아줘".
- "NONE" for any other question, including general judgment, wording suggestions, or evidence-sufficiency questions that do not ask to locate a specific law.

Return only "LAW_SEARCH" or "NONE". No explanation, no punctuation.`;
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx vitest run src/server/ai/review-ai-service.test.ts src/server/ai/prompt-registry.test.ts`
Expected: PASS (신규 + 기존 테스트 모두 통과)

- [ ] **Step 8: 커밋**

```bash
git add src/server/ai/review-ai-service.ts src/server/ai/review-ai-service.test.ts src/server/ai/prompt-registry.ts src/server/ai/prompt-registry.test.ts
git commit -m "feat(chat): add authoritative law evidence axis to rag_chat prompt"
```

---

## Task 2: 법령검색 의도 분류 (정규식 프리필터 + LLM 폴백)

**Files:**
- Create: `src/server/ai/law-search-intent.ts`
- Test: `src/server/ai/law-search-intent.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/server/ai/law-search-intent.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  classifyLawSearchIntent,
  prefilterLawSearchIntent
} from "./law-search-intent";
import type { ModelProvider } from "./model-provider";

function provider(text: string): ModelProvider {
  return {
    generateText: vi.fn().mockResolvedValue({ provider: "openai", model: "m", text })
  };
}

describe("prefilterLawSearchIntent", () => {
  it("returns law_search when a search verb and a law object are both present", () => {
    expect(prefilterLawSearchIntent("전자금융거래법 관련 조항 찾아줘")).toBe("law_search");
  });

  it("returns none when there is no legal hint at all", () => {
    expect(prefilterLawSearchIntent("이 배너 문구 더 짧게 다듬어줘")).toBe("none");
  });

  it("returns ambiguous when a legal hint exists but intent is unclear", () => {
    expect(prefilterLawSearchIntent("이 문구는 규정에 맞나요?")).toBe("ambiguous");
  });
});

describe("classifyLawSearchIntent", () => {
  it("short-circuits on a confident prefilter without calling the model", async () => {
    const model = provider("NONE");
    const result = await classifyLawSearchIntent("전자금융거래법 조항 찾아줘", model);
    expect(result).toBe("law_search");
    expect(model.generateText).not.toHaveBeenCalled();
  });

  it("delegates ambiguous questions to the model", async () => {
    const model = provider("LAW_SEARCH");
    const result = await classifyLawSearchIntent("이 문구는 규정에 맞나요?", model);
    expect(result).toBe("law_search");
    expect(model.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ task: "law_search_intent" })
    );
  });

  it("treats a non-LAW_SEARCH model reply as none", async () => {
    const model = provider("NONE");
    const result = await classifyLawSearchIntent("이 문구는 규정에 맞나요?", model);
    expect(result).toBe("none");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/server/ai/law-search-intent.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/server/ai/law-search-intent.ts`:

```ts
import { createModelProvider, type ModelProvider } from "./model-provider";
import { LAW_SEARCH_INTENT_PROMPT } from "./prompt-registry";

export type LawSearchIntent = "law_search" | "none";

const SEARCH_ACTION =
  /검색|찾아|알려\s*주|무슨\s*법|어떤\s*(법|법령|조항|조문|규정)|관련\s*(법|법령|규정|조항|조문)|근거\s*(법령|법|조항|조문)|법적\s*근거/;
const LAW_OBJECT = /[가-힣A-Za-z0-9·]{2,}법(?:률)?|시행령|시행규칙|감독규정|고시|조항|조문/;
const LEGAL_HINT = /법|령|규정|조항|조문|고시|감독|약관/;

export function prefilterLawSearchIntent(question: string): LawSearchIntent | "ambiguous" {
  const normalized = question.replace(/\s+/g, " ").trim();

  if (SEARCH_ACTION.test(normalized) && LAW_OBJECT.test(normalized)) {
    return "law_search";
  }

  if (!LEGAL_HINT.test(normalized)) {
    return "none";
  }

  return "ambiguous";
}

export async function classifyLawSearchIntent(
  question: string,
  provider: ModelProvider = createModelProvider()
): Promise<LawSearchIntent> {
  const prefiltered = prefilterLawSearchIntent(question);

  if (prefiltered !== "ambiguous") {
    return prefiltered;
  }

  const result = await provider.generateText({
    task: "law_search_intent",
    instructions: LAW_SEARCH_INTENT_PROMPT,
    input: JSON.stringify({ question }),
    fallback: "NONE"
  });

  return /LAW_SEARCH/i.test(result.text) ? "law_search" : "none";
}
```

참고: deterministic 모델 프로바이더는 `fallback`("NONE")을 그대로 반환하므로, 로컬/테스트 기본 환경에서 애매한 질문은 보수적으로 `none`으로 분류된다(= MCP 미호출). `task: "law_search_intent"`는 `ModelRouteTask` union에 없지만, `selectModelRoute`의 기본 분기가 `default_text` 티어로 라우팅하므로 union 수정은 불필요하다(`model-router.ts:262-267`).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/server/ai/law-search-intent.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/server/ai/law-search-intent.ts src/server/ai/law-search-intent.test.ts
git commit -m "feat(chat): add regex+LLM law-search intent classifier"
```

---

## Task 3: 법령명 추출 + 지식문서 커버리지 판정

**Files:**
- Create: `src/server/ai/law-coverage.ts`
- Test: `src/server/ai/law-coverage.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/server/ai/law-coverage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assessLawCoverage, extractLawName } from "./law-coverage";
import type { Evidence } from "@/domain/types";

function lawEvidence(title: string, score: number): Evidence {
  return {
    id: `ev-${title}`,
    sourceType: "law",
    title,
    quoteSummary: "요약",
    relevanceScore: score
  };
}

describe("extractLawName", () => {
  it("extracts a contiguous law token", () => {
    expect(extractLawName("전자금융거래법에서 관련 조항 찾아줘")).toBe("전자금융거래법");
  });

  it("extracts an '…에 관한 법률' form", () => {
    expect(extractLawName("금융소비자 보호에 관한 법률 조항 알려줘")).toContain("관한 법률");
  });

  it("returns undefined when no law name is present", () => {
    expect(extractLawName("이 문구 더 짧게 해줘")).toBeUndefined();
  });
});

describe("assessLawCoverage", () => {
  const minScore = 0.5;

  it("is covered when a matching law evidence is above threshold", () => {
    expect(
      assessLawCoverage([lawEvidence("전자금융거래법", 0.8)], "전자금융거래법 조항 찾아줘", minScore)
    ).toBe(true);
  });

  it("is not covered when no law evidence matches the requested law name", () => {
    expect(
      assessLawCoverage([lawEvidence("금융소비자보호법", 0.8)], "전자금융거래법 조항 찾아줘", minScore)
    ).toBe(false);
  });

  it("is not covered when there is no authoritative evidence at all", () => {
    expect(assessLawCoverage([], "전자금융거래법 조항 찾아줘", minScore)).toBe(false);
  });

  it("is not covered when matching evidence is below threshold", () => {
    expect(
      assessLawCoverage([lawEvidence("전자금융거래법", 0.3)], "전자금융거래법 조항 찾아줘", minScore)
    ).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/server/ai/law-coverage.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/server/ai/law-coverage.ts`:

```ts
import type { Evidence } from "@/domain/types";

const LAW_NAME_PATTERNS: RegExp[] = [
  /[가-힣]{2,}\s*에\s*관한\s*법률/,
  /[가-힣A-Za-z0-9·]{2,}법(?:률)?/
];

export function extractLawName(question: string): string | undefined {
  for (const pattern of LAW_NAME_PATTERNS) {
    const match = question.match(pattern);

    if (match) {
      return match[0].trim();
    }
  }

  return undefined;
}

export function assessLawCoverage(
  evidence: Evidence[],
  question: string,
  minScore: number
): boolean {
  const authoritative = evidence.filter(
    (item) =>
      (item.sourceType === "law" || item.sourceType === "internal_policy") &&
      item.relevanceScore >= minScore
  );

  if (authoritative.length === 0) {
    return false;
  }

  const lawName = extractLawName(question);

  if (!lawName) {
    return true;
  }

  const normalized = lawName.replace(/\s+/g, "");

  return authoritative.some((item) => item.title.replace(/\s+/g, "").includes(normalized));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/server/ai/law-coverage.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/server/ai/law-coverage.ts src/server/ai/law-coverage.test.ts
git commit -m "feat(chat): add law-name extraction and knowledge coverage check"
```

---

## Task 4: MCP 법령 응답 → Evidence 매핑

**Files:**
- Create: `src/server/reviews/mcp-law-evidence.ts`
- Test: `src/server/reviews/mcp-law-evidence.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/server/reviews/mcp-law-evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapLawTextToEvidence } from "./mcp-law-evidence";

describe("mapLawTextToEvidence", () => {
  it("maps MCP law text into a law-sourced Evidence with effective date and 현행 section", () => {
    const evidence = mapLawTextToEvidence(
      { lawId: "123456", title: "전자금융거래법" },
      {
        text: "시행일: 2026-07-01\n[현행]\n제1조(목적) 이 법은 ...",
        effectiveFrom: "2026-07-01",
        isCurrent: true
      },
      "전자금융거래법"
    );

    expect(evidence.id).toBe("law-mcp-123456");
    expect(evidence.sourceType).toBe("law");
    expect(evidence.title).toBe("전자금융거래법");
    expect(evidence.effectiveFrom).toBe("2026-07-01");
    expect(evidence.section).toBe("[현행]");
    expect(evidence.quoteSummary).toContain("제1조");
    expect(evidence.relevanceScore).toBeGreaterThan(0.5);
  });

  it("falls back to the searched law name when the search result has no title", () => {
    const evidence = mapLawTextToEvidence(
      { mst: "267581" },
      { text: "제2조 ...", isCurrent: false },
      "어떤 규정법"
    );

    expect(evidence.id).toBe("law-mcp-267581");
    expect(evidence.title).toBe("어떤 규정법");
    expect(evidence.section).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/server/reviews/mcp-law-evidence.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/server/reviews/mcp-law-evidence.ts`:

```ts
import type { Evidence } from "@/domain/types";
import type {
  GetLawTextResult,
  SearchLawResult
} from "@/server/regulatory/korean-law-mcp-client";

const MAX_QUOTE_LENGTH = 600;
const LAW_EVIDENCE_SCORE = 0.9;

export function mapLawTextToEvidence(
  found: SearchLawResult,
  lawText: GetLawTextResult,
  lawName: string
): Evidence {
  const quoteSummary = lawText.text.replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE_LENGTH);

  return {
    id: `law-mcp-${found.lawId ?? found.mst ?? lawName}`,
    sourceType: "law",
    title: found.title ?? lawName,
    quoteSummary,
    relevanceScore: LAW_EVIDENCE_SCORE,
    ...(lawText.effectiveFrom ? { effectiveFrom: lawText.effectiveFrom } : {}),
    ...(lawText.isCurrent ? { section: "[현행]" } : {})
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/server/reviews/mcp-law-evidence.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/server/reviews/mcp-law-evidence.ts src/server/reviews/mcp-law-evidence.test.ts
git commit -m "feat(chat): map korean-law-mcp responses into law Evidence"
```

---

## Task 5: 진행 이벤트 제너레이터 + NDJSON 스트림 헬퍼

채팅 오케스트레이션을 HTTP/인증과 분리해 테스트 가능한 async generator로 만든다. 2-게이트 분기와 MCP 호출 순서를 여기서 담당한다.

**Files:**
- Create: `src/server/reviews/review-chat-stream.ts`
- Modify: `src/domain/chat.ts:1-10` (타입 추가), 파일 끝(헬퍼 추가)
- Test: `src/server/reviews/review-chat-stream.test.ts`, `src/domain/chat.test.ts`

- [ ] **Step 1: 도메인 타입/헬퍼 실패 테스트 작성**

`src/domain/chat.test.ts`가 없으면 생성, 있으면 추가:

```ts
import { describe, expect, it } from "vitest";
import { chatProgressLabel } from "./chat";

describe("chatProgressLabel", () => {
  it("returns the event label for a stage event", () => {
    expect(chatProgressLabel({ type: "stage", stage: "searching_knowledge", label: "등록된 지식문서 검색 중" })).toBe(
      "등록된 지식문서 검색 중"
    );
  });

  it("returns the default label for null, done, or error events", () => {
    expect(chatProgressLabel(null)).toBe("답변 생성 중");
    expect(chatProgressLabel({ type: "error", message: "x" })).toBe("답변 생성 중");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/domain/chat.test.ts -t "chatProgressLabel"`
Expected: FAIL — export 없음.

- [ ] **Step 3: 도메인 타입/헬퍼 구현**

`src/domain/chat.ts`의 `ReviewChatResponse` 타입(`:3-10`) 바로 아래에 추가:

```ts
export type ChatProgressStage =
  | "analyzing_intent"
  | "searching_knowledge"
  | "knowledge_hit"
  | "knowledge_miss"
  | "mcp_failed"
  | "generating_answer";

export type ChatProgressEvent =
  | { type: "stage"; stage: ChatProgressStage; label: string }
  | { type: "mcp"; stage: "mcp_search_law" | "mcp_get_law_text"; tool: string; query: string; label: string }
  | { type: "done"; response: ReviewChatResponse }
  | { type: "error"; message: string };

export function chatProgressLabel(event: ChatProgressEvent | null): string {
  if (!event || event.type === "done" || event.type === "error") {
    return "답변 생성 중";
  }

  return event.label;
}
```

- [ ] **Step 4: 스트림 제너레이터 실패 테스트 작성**

`src/server/reviews/review-chat-stream.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ndjsonStream, streamReviewChat, type ReviewChatStreamDeps } from "./review-chat-stream";
import type { ChatProgressEvent } from "@/domain/chat";
import { getReviewCaseById } from "@/domain/reviews";

const review = getReviewCaseById("rc-demo-deposit-001")!;
const issue = review.issues[0];

function baseDeps(overrides: Partial<ReviewChatStreamDeps>): ReviewChatStreamDeps {
  return {
    classifyIntent: vi.fn().mockResolvedValue("none"),
    searchKnowledge: vi.fn().mockResolvedValue([]),
    lawClient: {
      searchLaw: vi.fn(),
      getLawText: vi.fn()
    },
    answer: vi.fn().mockResolvedValue({
      id: "msg-1",
      question: "q",
      answerType: "evidence_based",
      content: "답변",
      evidence: [],
      requiredMaterials: []
    }),
    coverageMinScore: 0.5,
    ...overrides
  };
}

async function collect(gen: AsyncGenerator<ChatProgressEvent>): Promise<ChatProgressEvent[]> {
  const events: ChatProgressEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("streamReviewChat", () => {
  it("never calls the MCP when intent is not law_search", async () => {
    const deps = baseDeps({ classifyIntent: vi.fn().mockResolvedValue("none") });
    const events = await collect(
      streamReviewChat({ review, issue, question: "이 문구 다듬어줘" }, deps)
    );

    expect(deps.lawClient.searchLaw).not.toHaveBeenCalled();
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({ authoritativeLawEvidence: [] })
    );
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("skips the MCP when the knowledge base already covers the law", async () => {
    const deps = baseDeps({
      classifyIntent: vi.fn().mockResolvedValue("law_search"),
      searchKnowledge: vi.fn().mockResolvedValue([
        { id: "e1", sourceType: "law", title: "전자금융거래법", quoteSummary: "x", relevanceScore: 0.8 }
      ])
    });
    await collect(streamReviewChat({ review, issue, question: "전자금융거래법 조항 찾아줘" }, deps));

    expect(deps.lawClient.searchLaw).not.toHaveBeenCalled();
  });

  it("calls the MCP and passes law evidence to answer when uncovered", async () => {
    const searchLaw = vi.fn().mockResolvedValue({ lawId: "123456", title: "전자금융거래법" });
    const getLawText = vi
      .fn()
      .mockResolvedValue({ text: "[현행]\n제1조 ...", effectiveFrom: "2026-07-01", isCurrent: true });
    const deps = baseDeps({
      classifyIntent: vi.fn().mockResolvedValue("law_search"),
      searchKnowledge: vi.fn().mockResolvedValue([]),
      lawClient: { searchLaw, getLawText }
    });

    const events = await collect(
      streamReviewChat({ review, issue, question: "전자금융거래법 관련 조항 찾아줘" }, deps)
    );

    expect(searchLaw).toHaveBeenCalledWith("전자금융거래법");
    expect(getLawText).toHaveBeenCalledWith({ lawId: "123456" });
    expect(events.some((e) => e.type === "mcp" && e.stage === "mcp_search_law")).toBe(true);
    expect(events.some((e) => e.type === "mcp" && e.stage === "mcp_get_law_text")).toBe(true);
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        authoritativeLawEvidence: [expect.objectContaining({ title: "전자금융거래법" })]
      })
    );
  });

  it("degrades to RAG-only when the MCP throws", async () => {
    const deps = baseDeps({
      classifyIntent: vi.fn().mockResolvedValue("law_search"),
      searchKnowledge: vi.fn().mockResolvedValue([]),
      lawClient: {
        searchLaw: vi.fn().mockRejectedValue(new Error("timeout")),
        getLawText: vi.fn()
      }
    });

    const events = await collect(
      streamReviewChat({ review, issue, question: "전자금융거래법 조항 찾아줘" }, deps)
    );

    expect(events.some((e) => e.type === "stage" && e.stage === "mcp_failed")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({ authoritativeLawEvidence: [] })
    );
  });
});

describe("ndjsonStream", () => {
  it("serializes each event as one NDJSON line", async () => {
    async function* gen(): AsyncGenerator<ChatProgressEvent> {
      yield { type: "stage", stage: "analyzing_intent", label: "질문 의도 분석 중" };
      yield { type: "error", message: "done-sentinel" };
    }

    const stream = ndjsonStream(gen());
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }

    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ stage: "analyzing_intent" });
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `npx vitest run src/server/reviews/review-chat-stream.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 6: 스트림 제너레이터 구현**

`src/server/reviews/review-chat-stream.ts`:

```ts
import type { ChatProgressEvent, ReviewChatResponse } from "@/domain/chat";
import type { Evidence, ReviewCase, ReviewIssue } from "@/domain/types";
import type { LawSearchIntent } from "@/server/ai/law-search-intent";
import { assessLawCoverage, extractLawName } from "@/server/ai/law-coverage";
import type { KoreanLawMcpClient } from "@/server/regulatory/korean-law-mcp-client";
import { mapLawTextToEvidence } from "./mcp-law-evidence";

type AnswerInput = {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
  history?: Array<{ question: string; answer: string }>;
  knowledgeEvidence: Evidence[];
  authoritativeLawEvidence: Evidence[];
};

export type ReviewChatStreamDeps = {
  classifyIntent: (question: string) => Promise<LawSearchIntent>;
  searchKnowledge: () => Promise<Evidence[]>;
  lawClient: KoreanLawMcpClient;
  answer: (input: AnswerInput) => Promise<ReviewChatResponse>;
  coverageMinScore: number;
};

export type ReviewChatStreamParams = {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
  history?: Array<{ question: string; answer: string }>;
};

export async function* streamReviewChat(
  params: ReviewChatStreamParams,
  deps: ReviewChatStreamDeps
): AsyncGenerator<ChatProgressEvent> {
  const { review, issue, question, history } = params;

  yield { type: "stage", stage: "analyzing_intent", label: "질문 의도 분석 중" };
  const intent = await deps.classifyIntent(question);

  yield { type: "stage", stage: "searching_knowledge", label: "등록된 지식문서 검색 중" };
  const knowledgeEvidence = await deps.searchKnowledge();

  let authoritativeLawEvidence: Evidence[] = [];
  const covered = assessLawCoverage(knowledgeEvidence, question, deps.coverageMinScore);
  const lawName = intent === "law_search" ? extractLawName(question) : undefined;

  if (intent === "law_search" && !covered && lawName) {
    yield { type: "stage", stage: "knowledge_miss", label: "지식문서에 없음 — 국가법령정보 조회" };

    try {
      yield {
        type: "mcp",
        stage: "mcp_search_law",
        tool: "search_law",
        query: lawName,
        label: `법령 검색 중: ${lawName}`
      };
      const found = await deps.lawClient.searchLaw(lawName);

      if (found.lawId || found.mst) {
        yield {
          type: "mcp",
          stage: "mcp_get_law_text",
          tool: "get_law_text",
          query: found.title ?? lawName,
          label: "조문 원문 조회 중"
        };
        const lawText = await deps.lawClient.getLawText({
          ...(found.lawId ? { lawId: found.lawId } : {}),
          ...(found.mst ? { mst: found.mst } : {})
        });

        if (lawText.text.trim().length > 0) {
          authoritativeLawEvidence = [mapLawTextToEvidence(found, lawText, lawName)];
        }
      }
    } catch {
      yield {
        type: "stage",
        stage: "mcp_failed",
        label: "법제처 실시간 조회 실패 — 등록된 근거로 답변합니다"
      };
    }
  } else {
    yield { type: "stage", stage: "knowledge_hit", label: "등록된 근거로 답변 작성 중" };
  }

  yield { type: "stage", stage: "generating_answer", label: "근거 종합 답변 생성 중" };
  const response = await deps.answer({
    review,
    issue,
    question,
    history,
    knowledgeEvidence,
    authoritativeLawEvidence
  });

  yield { type: "done", response };
}

export function ndjsonStream(
  events: AsyncGenerator<ChatProgressEvent>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "error", message: "질문 요청을 처리하지 못했습니다." })}\n`
          )
        );
      } finally {
        controller.close();
      }
    }
  });
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx vitest run src/server/reviews/review-chat-stream.test.ts src/domain/chat.test.ts`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add src/server/reviews/review-chat-stream.ts src/server/reviews/review-chat-stream.test.ts src/domain/chat.ts src/domain/chat.test.ts
git commit -m "feat(chat): add gated MCP chat progress stream generator"
```

---

## Task 6: 채팅 라우트를 NDJSON 스트림으로 전환

**Files:**
- Modify: `src/app/api/v1/review-cases/[caseId]/chat/route.ts` (전체 교체)

- [ ] **Step 1: 라우트 구현 교체**

`src/app/api/v1/review-cases/[caseId]/chat/route.ts` 전체를 아래로 교체:

```ts
import type { Evidence, ReviewCase, ReviewIssue } from "@/domain/types";
import { getAnalysisProviderConfig } from "@/server/analysis/provider-config";
import { createReranker } from "@/server/analysis/rerank-provider";
import { classifyLawSearchIntent } from "@/server/ai/law-search-intent";
import { answerReviewQuestionWithModel } from "@/server/ai/review-ai-service";
import { createEmbeddingProvider } from "@/server/knowledge/embedding-provider";
import { createKoreanLawMcpClient } from "@/server/regulatory/korean-law-mcp-client";
import {
  ndjsonStream,
  streamReviewChat,
  type ReviewChatStreamDeps
} from "@/server/reviews/review-chat-stream";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type ChatRequest = {
  issueId?: string;
  question?: string;
  history?: Array<{
    question: string;
    answer: string;
  }>;
};

function chatKnowledgeQuery(review: ReviewCase, issue: ReviewIssue, question: string): string {
  return [
    question,
    issue.title,
    issue.targetText,
    issue.description,
    review.title,
    review.affiliate,
    review.productType,
    review.promotionalCopy,
    review.disclosure
  ]
    .filter((item) => item && item.trim().length > 0)
    .join("\n");
}

async function createQueryEmbedding(query: string): Promise<number[] | undefined> {
  try {
    const [embedding] = await createEmbeddingProvider().embed([query]);

    return embedding;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<ChatRequest>(request);

  if (!body?.issueId || !body.question) {
    return jsonError("issueId and question are required", 400);
  }

  const service = createReviewService();
  const contextValue = await requestContext(request);
  const review = await service.getReviewCase(contextValue, caseId);
  const issue = await service.getIssue(contextValue, caseId, body.issueId);

  if (!review || !issue) {
    return jsonError("Review case or issue not found", 404);
  }

  const analysisConfig = getAnalysisProviderConfig();
  const knowledgeQuery = chatKnowledgeQuery(review, issue, body.question);

  const deps: ReviewChatStreamDeps = {
    classifyIntent: (question) => classifyLawSearchIntent(question),
    searchKnowledge: async () => {
      const queryEmbedding = await createQueryEmbedding(knowledgeQuery);
      const knowledgeCandidates = await service.searchKnowledgeEvidence(contextValue, {
        query: knowledgeQuery,
        productType: review.productType,
        effectiveOn: review.plannedPublishDate,
        topK: analysisConfig.rag.topK * 2,
        minScore: analysisConfig.rag.minScore,
        queryEmbedding
      });

      if (!knowledgeCandidates.length) {
        return [] as Evidence[];
      }

      return (
        await createReranker().rerank({
          query: knowledgeQuery,
          candidates: knowledgeCandidates
        })
      ).slice(0, analysisConfig.rerank.topK);
    },
    lawClient: createKoreanLawMcpClient(),
    answer: (input) => answerReviewQuestionWithModel(input),
    coverageMinScore: analysisConfig.rag.minScore
  };

  const events = streamReviewChat(
    { review, issue, question: body.question, history: body.history },
    deps
  );

  return new Response(ndjsonStream(events), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no"
    }
  });
}
```

- [ ] **Step 2: 타입/린트 확인**

Run: `npx tsc --noEmit` (프로젝트에 타입체크 스크립트가 있으면 `npm run typecheck`)
Expected: 오류 없음. (특히 `answerReviewQuestionWithModel` 입력 형태와 `ReviewChatStreamDeps.answer` 시그니처 정합 확인)

- [ ] **Step 3: 전체 서버 테스트 확인**

Run: `npx vitest run src/server src/domain`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add "src/app/api/v1/review-cases/[caseId]/chat/route.ts"
git commit -m "feat(chat): stream chat responses as NDJSON with MCP progress"
```

---

## Task 7: 클라이언트 스트림 파싱 + 진행상황 표시 UI

**Files:**
- Modify: `src/components/ReviewDetailWorkspace.tsx` — import(`:1` 근처), 상태(`:430-431` 근처), `handleAskQuestion`(`:692-747`), 진행 표시 렌더(`:1193-1200`)

- [ ] **Step 1: import에 진행 이벤트 타입/헬퍼 추가**

`ReviewDetailWorkspace.tsx` 상단에서 `@/domain/chat`를 이미 참조하는지 확인하고, `ReviewChatResponse`를 가져오는 import 구문에 `ChatProgressEvent`, `chatProgressLabel`을 추가한다. 없다면 새 import 추가:

```ts
import { chatProgressLabel, type ChatProgressEvent, type ReviewChatResponse } from "@/domain/chat";
```

(기존에 `ReviewChatResponse`가 다른 경로/구문으로 import되어 있으면 중복 제거하고 위 한 줄로 통합)

- [ ] **Step 2: 진행상황 상태 추가**

`const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);`(`:431`) 바로 아래에 추가:

```ts
  const [chatProgress, setChatProgress] = useState<ChatProgressEvent | null>(null);
```

- [ ] **Step 3: handleAskQuestion을 스트림 파싱으로 교체**

`handleAskQuestion`(`:692-747`)의 `try { ... }` 블록 내부 fetch~append 로직을 아래로 교체(함수 시그니처·앞부분 상태세팅·`catch`/`finally`의 기존 복구 로직은 유지하되, `finally`에 `setChatProgress(null)` 추가):

```ts
    setInteractionError(null);
    setIsAskingQuestion(true);
    setPendingQuestion({ issueId, question: submittedQuestion });
    setChatProgress(null);
    setQuestion("");
    try {
      const apiResponse = await fetch(`/api/v1/review-cases/${reviewCaseId}/chat`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          issueId,
          question: submittedQuestion,
          history: (currentReviewChatResponses[issueId] ?? []).map((response) => ({
            question: response.question,
            answer: response.content
          }))
        })
      });

      if (!apiResponse.ok || !apiResponse.body) {
        throw new Error("질문 요청을 처리하지 못했습니다.");
      }

      const reader = apiResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResponse: ReviewChatResponse | null = null;

      for (;;) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim().length === 0) {
            continue;
          }

          const event = JSON.parse(line) as ChatProgressEvent;

          if (event.type === "done") {
            finalResponse = event.response;
          } else if (event.type !== "error") {
            setChatProgress(event);
          }
        }
      }

      if (!finalResponse) {
        throw new Error("질문 요청을 처리하지 못했습니다.");
      }

      const answered = finalResponse;

      setChatResponsesByReviewId((current) => {
        const currentReviewResponses = current[reviewCaseId] ?? {};

        return {
          ...current,
          [reviewCaseId]: {
            ...currentReviewResponses,
            [issueId]: [...(currentReviewResponses[issueId] ?? []), answered]
          }
        };
      });
      setHasUnreadChatResponse(true);
    } catch (error) {
      setQuestion(submittedQuestion);
      setInteractionError(
        error instanceof Error ? error.message : "질문 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsAskingQuestion(false);
      setPendingQuestion(null);
      setChatProgress(null);
    }
```

- [ ] **Step 4: 진행 표시 렌더 교체**

`ReviewDetailWorkspace.tsx:1193-1200`의 로딩 버블 내부를 교체:

```tsx
              <div className="chat-message__bubble chat-message__bubble--loading">
                <span>{chatProgressLabel(chatProgress)}</span>
                {chatProgress?.type === "mcp" ? (
                  <span className="chat-message__progress-tool">
                    {chatProgress.tool} · {chatProgress.query}
                  </span>
                ) : null}
                <span className="typing-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
```

- [ ] **Step 5: 진행 도구 서브라인 스타일 추가**

`src/app/globals.css`에서 `.chat-message__bubble--loading` 규칙을 찾아 그 아래에 추가(없으면 파일 끝에 추가):

```css
.chat-message__progress-tool {
  display: block;
  margin-top: 2px;
  font-size: 0.75rem;
  color: var(--muted-foreground, #6b7280);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 6: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공(타입 오류 없음).

- [ ] **Step 7: 수동 검증 (dev 서버)**

Run: `npm run dev` 후 리뷰 케이스 상세 → 이슈 선택 → 채팅에서 두 가지 질문으로 확인:
1. "이 문구 더 짧게 다듬어줘" → 진행 표시가 `질문 의도 분석 중 → 등록된 지식문서 검색 중 → 근거 종합 답변 생성 중`만 스쳐 지나가고 MCP 라인이 뜨지 않음.
2. 지식문서에 없는 법을 명시한 질문(예: "전자금융거래법 관련 조항 찾아줘") → `지식문서에 없음 — 국가법령정보 조회` 이후 `search_law · 전자금융거래법`, `조문 원문 조회 중` 서브라인이 표시되고, 최종 답변에 법령 시행일/현행 정보가 인용됨.

Expected: 위 두 흐름이 UI에 순서대로 표시되고, 최종 답변이 정상 append + localStorage 캐시됨.

- [ ] **Step 8: 커밋**

```bash
git add src/components/ReviewDetailWorkspace.tsx src/app/globals.css
git commit -m "feat(chat): render live MCP search progress in chat widget"
```

---

## Self-Review 결과

**1. Spec coverage**
- 요구① "관련 법 검색 의도일 때만 MCP" → Task 2(intent 분류) + Task 5 게이트(`intent === "law_search"`). ✅
- 요구② "지식문서 등록 시 등록정보 우선, 미등록만 MCP" → Task 3(coverage) + Task 5 게이트(`!covered`). ✅
- 요구③ "정규식 프리필터 + 애매 시 LLM" → Task 2 `prefilterLawSearchIntent`/`classifyLawSearchIntent`. ✅
- 요구④ "MCP 조회 중 어떤 MCP를 검색 중인지 진행상황 UI" → Task 5 이벤트(`mcp_search_law`/`mcp_get_law_text` + tool/query) + Task 6 스트림 + Task 7 렌더. ✅
- 법령 원문 근거 강화 → Task 1(`authoritativeLawEvidence` 축 + 프롬프트 우선 규칙) + Task 4(매핑). ✅

**2. Placeholder scan** — 모든 코드 스텝에 실제 코드/명령/기대 출력 포함. 플레이스홀더 없음. ✅

**3. Type consistency**
- `ChatProgressEvent`/`ChatProgressStage`/`chatProgressLabel`(domain/chat.ts) → Task 5 정의, Task 6·7에서 동일 사용. ✅
- `ReviewChatStreamDeps.answer`의 입력(knowledgeEvidence, authoritativeLawEvidence 필수) ↔ `answerReviewQuestionWithModel`의 `AnswerQuestionInput`(둘 다 optional) → 호출 시 전달하므로 정합. ✅
- `mapLawTextToEvidence(found, lawText, lawName)` 인자 순서 → Task 4 정의, Task 5 호출 동일. ✅
- `getLawText` 인자 키 `lawId`/`mst`(소문자) → 기존 클라이언트 시그니처(`GetLawTextParams`)와 일치. ✅
- `extractLawName`/`assessLawCoverage` 시그니처 → Task 3 정의, Task 5 사용 동일. ✅

**주의 사항(구현자 참고)**
- `classifyLawSearchIntent`는 기본 deterministic 모델에서 애매 질문을 `none`으로 분류(MCP 미호출) → 실제 LLM 폴백을 보려면 `FINPROOF_MODEL_PROVIDER=openai|router` + `OPENAI_API_KEY` 필요.
- MCP 호출에는 `.env`의 `LAW_API_OC`(이미 설정됨)와 기본 엔드포인트 `korean-law-mcp.fly.dev`가 사용됨. 대화형 지연을 줄이려면 `KOREAN_LAW_MCP_TIMEOUT_MS`를 8000~10000으로 낮추는 것을 권장(선택).
</content>
</invoke>
