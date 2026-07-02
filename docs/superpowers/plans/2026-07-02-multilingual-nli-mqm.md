# 다국어 NLI 의미보존 + MQM taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다국어 광고 finding에 (1) mDeBERTa-v3-base-mnli-xnli NLI 기반 의미보존 검증과 (2) MQM 오류 taxonomy 구조를 부착한다.

**Architecture:** 번역 LLM 에이전트가 finding + MQM 필드를 생성하고, 별도 Python NLI 마이크로서비스(`finproof-nli :8001`)를 호출하는 결정론적 후처리 단계 `enrichSemanticPreservation()`가 NLI 확률에서 의미보존 필드를 파생한다. NLI 실패 시 기존 필드를 유지하는 graceful degradation. 신규 필드는 모두 optional이라 하위 호환된다.

**Tech Stack:** TypeScript / Next.js, vitest 4, Python FastAPI + HuggingFace transformers, systemd.

**Spec:** `docs/superpowers/specs/2026-07-02-multilingual-nli-mqm-design.md`

---

## File Structure

- `src/server/analysis/multilingual.ts` — 신규 타입(`SemanticPreservation`, `MqmAssessment` 등) + `LocalizedRiskFinding` 확장 (Task 1)
- `src/domain/types.ts` — `MultilingualIssueContext` 확장 (Task 1)
- `src/server/analysis/multilingual-risk-team.ts` — MQM 정규화, NLI enrich 배선 (Task 2, 6)
- `src/server/ai/prompt-registry.ts` — 번역 에이전트 프롬프트에 MQM 지시 추가 (Task 3)
- `src/server/ai/nli-client.ts` — 신규. NLI 클라이언트 인터페이스 + HTTP 구현 (Task 4)
- `src/server/analysis/semantic-preservation.ts` — 신규. 관계 매핑 + enrich (Task 5)
- `src/server/analysis/review-analysis-pipeline.ts` — 플래그로 NLI 클라이언트 주입 (Task 6)
- `services/nli/` — 신규 Python 서비스 (Task 7)
- `.env.example` — 신규 env 문서화 (Task 8)

---

## Task 1: 타입 확장

**Files:**
- Modify: `src/server/analysis/multilingual.ts:17-30`
- Modify: `src/domain/types.ts:73-86`

- [ ] **Step 1: `multilingual.ts`에 신규 타입 추가**

`src/server/analysis/multilingual.ts`의 `LocalizedRiskFinding` 타입(17-30줄) **바로 위**에 삽입:

```ts
export type SemanticRelation =
  | "equivalent"
  | "stronger"
  | "weaker"
  | "contradiction"
  | "missing-condition";

export type SemanticPreservation = {
  semanticRelation: SemanticRelation;
  semanticShiftScore: number;
  missingConditionTerms: string[];
  overclaimTerms: string[];
  nliProbabilities: { entailment: number; neutral: number; contradiction: number };
  model: string;
};

export type MqmErrorType =
  | "mistranslation"
  | "omission"
  | "addition"
  | "terminology"
  | "inconsistency"
  | "locale_convention";

export type MqmSeverity = "minor" | "major" | "critical";

export type MqmEvidenceType = "product_doc" | "internal_policy" | "law" | "case_history";

export type MqmAssessment = {
  errorType: MqmErrorType;
  complianceRiskType: string;
  severity: MqmSeverity;
  targetSpan: string;
  evidenceType: MqmEvidenceType;
  recommendedAction: ReviewIssue["suggestedAction"];
};
```

- [ ] **Step 2: `LocalizedRiskFinding`에 optional 필드 추가**

`src/server/analysis/multilingual.ts`의 `LocalizedRiskFinding`에서 `confidence: number;` 줄 **뒤**에 추가:

```ts
  confidence: number;
  semanticPreservation?: SemanticPreservation;
  mqm?: MqmAssessment;
```

- [ ] **Step 3: `MultilingualIssueContext`에 동일 필드 추가**

`src/domain/types.ts`의 `MultilingualIssueContext`(73-86줄)에서 `suggestedCopyKoreanMeaning: string;` 줄 **뒤**에 추가. `MultilingualIssueContext`는 `multilingual.ts`의 타입을 import하지 않으므로 인라인으로 선언:

```ts
  suggestedCopyKoreanMeaning: string;
  semanticPreservation?: {
    semanticRelation: "equivalent" | "stronger" | "weaker" | "contradiction" | "missing-condition";
    semanticShiftScore: number;
    missingConditionTerms: string[];
    overclaimTerms: string[];
    nliProbabilities: { entailment: number; neutral: number; contradiction: number };
    model: string;
  };
  mqm?: {
    errorType: "mistranslation" | "omission" | "addition" | "terminology" | "inconsistency" | "locale_convention";
    complianceRiskType: string;
    severity: "minor" | "major" | "critical";
    targetSpan: string;
    evidenceType: "product_doc" | "internal_policy" | "law" | "case_history";
    recommendedAction: ReviewIssue["suggestedAction"];
  };
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors)

- [ ] **Step 5: Commit**

```bash
git add src/server/analysis/multilingual.ts src/domain/types.ts
git commit -m "feat(multilingual): add semanticPreservation and mqm types"
```

---

## Task 2: MQM 정규화

**Files:**
- Modify: `src/server/analysis/multilingual-risk-team.ts` (helpers near line 145; `normalizeLocalizedFinding` at 240-276)
- Test: `src/server/analysis/multilingual-risk-team.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server/analysis/multilingual-risk-team.test.ts`의 기존 `"calls only detected language agents and maps localized findings"` 테스트에서, `english_translator_risk`가 반환하는 finding 객체에 `mqm` 블록을 추가하고, 결과 finding이 정규화된 `mqm`을 담는지 확인하는 테스트를 새로 추가한다. 파일 하단 `describe` 안에 추가:

```ts
it("normalizes an mqm block on localized findings", async () => {
  const provider = providerReturning({
    english_translator_risk: JSON.stringify({
      findings: [
        {
          segmentId: "seg-en-001",
          language: "en",
          complianceMeaning: "승인 확정처럼 표현합니다.",
          riskCategory: "both",
          riskSignals: ["guaranteed approval"],
          riskLevelHint: "high",
          suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
          confidence: 0.88,
          mqm: {
            errorType: "addition",
            complianceRiskType: "approval_guarantee",
            severity: "major",
            targetSpan: "Guaranteed approval",
            evidenceType: "product_doc",
            recommendedAction: "change_request"
          }
        }
      ]
    }),
    korean_compliance_mapping: JSON.stringify({ mappings: [] })
  });

  const result = await runMultilingualRiskTeam({
    review,
    segments: segmentMultilingualDocuments([
      document("대출 광고\nGuaranteed approval in 3 minutes\n금리는 심사 후 확정")
    ]),
    evidenceCandidates: [],
    provider
  });

  expect(result.localizedRiskFindings[0]?.mqm).toEqual({
    errorType: "addition",
    complianceRiskType: "approval_guarantee",
    severity: "major",
    targetSpan: "Guaranteed approval",
    evidenceType: "product_doc",
    recommendedAction: "change_request"
  });
});

it("falls back to safe mqm defaults on unknown enum values", async () => {
  const provider = providerReturning({
    english_translator_risk: JSON.stringify({
      findings: [
        {
          segmentId: "seg-en-001",
          language: "en",
          complianceMeaning: "승인 확정처럼 표현합니다.",
          riskCategory: "both",
          riskSignals: ["guaranteed approval"],
          riskLevelHint: "caution",
          suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
          confidence: 0.8,
          mqm: {
            errorType: "not_a_real_type",
            complianceRiskType: "approval_guarantee",
            severity: "spicy",
            targetSpan: "Guaranteed approval",
            evidenceType: "vibes",
            recommendedAction: "change_request"
          }
        }
      ]
    }),
    korean_compliance_mapping: JSON.stringify({ mappings: [] })
  });

  const result = await runMultilingualRiskTeam({
    review,
    segments: segmentMultilingualDocuments([
      document("대출 광고\nGuaranteed approval in 3 minutes\n금리는 심사 후 확정")
    ]),
    evidenceCandidates: [],
    provider
  });

  expect(result.localizedRiskFindings[0]?.mqm).toMatchObject({
    errorType: "terminology",
    severity: "minor",
    evidenceType: "product_doc"
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- multilingual-risk-team`
Expected: FAIL — `mqm` is undefined

- [ ] **Step 3: 정규화 헬퍼 추가**

`src/server/analysis/multilingual-risk-team.ts`의 `normalizeRiskCategory`(145-151줄) **뒤**에 추가:

```ts
const MQM_ERROR_TYPES = [
  "mistranslation",
  "omission",
  "addition",
  "terminology",
  "inconsistency",
  "locale_convention"
] as const;

const MQM_SEVERITIES = ["minor", "major", "critical"] as const;
const MQM_EVIDENCE_TYPES = ["product_doc", "internal_policy", "law", "case_history"] as const;

function normalizeMqm(value: unknown): LocalizedRiskFinding["mqm"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const fields = value as Record<string, unknown>;
  const errorType = MQM_ERROR_TYPES.includes(fields.errorType as never)
    ? (fields.errorType as (typeof MQM_ERROR_TYPES)[number])
    : "terminology";
  const severity = MQM_SEVERITIES.includes(fields.severity as never)
    ? (fields.severity as (typeof MQM_SEVERITIES)[number])
    : "minor";
  const evidenceType = MQM_EVIDENCE_TYPES.includes(fields.evidenceType as never)
    ? (fields.evidenceType as (typeof MQM_EVIDENCE_TYPES)[number])
    : "product_doc";

  return {
    errorType,
    complianceRiskType: stringField(fields.complianceRiskType),
    severity,
    targetSpan: stringField(fields.targetSpan),
    evidenceType,
    recommendedAction: normalizeAction(fields.recommendedAction)
  };
}
```

- [ ] **Step 4: `normalizeLocalizedFinding`에서 mqm 부착**

`src/server/analysis/multilingual-risk-team.ts`의 `normalizeLocalizedFinding` return 객체(259-275줄)에서 `confidence: clampConfidence(fields.confidence)` 줄 **뒤**에 추가:

```ts
    confidence: clampConfidence(fields.confidence),
    mqm: normalizeMqm(fields.mqm)
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test -- multilingual-risk-team`
Expected: PASS (신규 2개 포함 전체 통과)

- [ ] **Step 6: Commit**

```bash
git add src/server/analysis/multilingual-risk-team.ts src/server/analysis/multilingual-risk-team.test.ts
git commit -m "feat(multilingual): normalize LLM-emitted MQM taxonomy on findings"
```

---

## Task 3: 번역 에이전트 프롬프트에 MQM 지시

**Files:**
- Modify: `src/server/ai/prompt-registry.ts` (`multilingualTranslatorRiskPrompt`, ~479-515)
- Modify: `src/server/analysis/multilingual-risk-team.ts` (`languageAgentInput` outputSchema, ~213-218)
- Test: `src/server/ai/prompt-registry.test.ts` (없으면 생성)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server/ai/prompt-registry.test.ts`가 없으면 생성, 있으면 추가:

```ts
import { describe, expect, it } from "vitest";
import { multilingualTranslatorRiskPrompt } from "./prompt-registry";

describe("multilingualTranslatorRiskPrompt", () => {
  it("instructs the agent to emit an mqm block with the six error types", () => {
    const prompt = multilingualTranslatorRiskPrompt("en");
    expect(prompt).toContain("mqm");
    expect(prompt).toContain("omission");
    expect(prompt).toContain("locale_convention");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- prompt-registry`
Expected: FAIL — prompt에 "mqm" 없음

- [ ] **Step 3: 프롬프트에 MQM 지시 추가**

`src/server/ai/prompt-registry.ts`의 `multilingualTranslatorRiskPrompt` 반환 문자열에서 `include riskSignals as ...` 항목 **뒤**, `${COMMON_RISK_POLICY_PROMPT}` **앞**에 삽입:

```
- also include an "mqm" object standardizing the error using MQM translation-quality typology adapted to Korean financial-advertising compliance:
  - errorType: exactly one of "mistranslation" (상품 조건 오역), "omission" (필수 고지 누락), "addition" (원문에 없는 혜택 추가), "terminology" (금융용어 불일치), "inconsistency" (약관/금리표/랜딩 간 불일치), "locale_convention" (국가/언어권 표기 혼선);
  - complianceRiskType: short snake_case tag, e.g. "required_disclosure_missing";
  - severity: "minor", "major", or "critical";
  - targetSpan: the offending original-language span;
  - evidenceType: one of "product_doc", "internal_policy", "law", "case_history";
  - recommendedAction: "approve", "change_request", or "hold".
```

- [ ] **Step 4: outputSchema에 mqm 추가**

`src/server/analysis/multilingual-risk-team.ts`의 `languageAgentInput` outputSchema.findings 문자열(214-215줄)에서 `..., confidence }` 를 다음으로 교체:

```ts
      findings:
        "array of { id, segmentId, language, originalText, literalTranslation, complianceMeaning, riskCategory, riskSignals, riskLevelHint, suggestedCopyOriginalLanguage, suggestedCopyKoreanMeaning, confidence, mqm }. mqm is { errorType, complianceRiskType, severity, targetSpan, evidenceType, recommendedAction }. id must be unique per localized risk finding.",
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test -- prompt-registry`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/prompt-registry.ts src/server/analysis/multilingual-risk-team.ts src/server/ai/prompt-registry.test.ts
git commit -m "feat(multilingual): instruct translator agents to emit MQM taxonomy"
```

---

## Task 4: NLI 클라이언트

**Files:**
- Create: `src/server/ai/nli-client.ts`
- Test: `src/server/ai/nli-client.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server/ai/nli-client.ts`가 아직 없으므로 테스트 파일 먼저 생성 `src/server/ai/nli-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpNliClient } from "./nli-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createHttpNliClient", () => {
  it("posts premise/hypothesis and returns normalized scores", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ scores: { entailment: 0.1, neutral: 0.2, contradiction: 0.7 } })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHttpNliClient({ baseUrl: "http://localhost:8001" });
    const scores = await client.classify({ premise: "가", hypothesis: "나" });

    expect(scores).toEqual({ entailment: 0.1, neutral: 0.2, contradiction: 0.7 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8001/nli",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws when the service responds with a non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const client = createHttpNliClient({ baseUrl: "http://localhost:8001" });
    await expect(client.classify({ premise: "가", hypothesis: "나" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- nli-client`
Expected: FAIL — module not found

- [ ] **Step 3: 클라이언트 구현**

`src/server/ai/nli-client.ts` 생성:

```ts
export type NliScores = {
  entailment: number;
  neutral: number;
  contradiction: number;
};

export type NliClient = {
  classify(input: { premise: string; hypothesis: string }): Promise<NliScores>;
};

function toScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function createHttpNliClient(config: {
  baseUrl: string;
  timeoutMs?: number;
}): NliClient {
  const timeoutMs = config.timeoutMs ?? 4000;

  return {
    async classify({ premise, hypothesis }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${config.baseUrl}/nli`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ premise, hypothesis }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`NLI service responded with ${response.status}`);
        }

        const data = (await response.json()) as { scores?: Record<string, unknown> };
        const scores = data.scores ?? {};

        return {
          entailment: toScore(scores.entailment),
          neutral: toScore(scores.neutral),
          contradiction: toScore(scores.contradiction)
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- nli-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/nli-client.ts src/server/ai/nli-client.test.ts
git commit -m "feat(ai): add HTTP NLI client for mDeBERTa service"
```

---

## Task 5: 의미보존 파생 (`enrichSemanticPreservation`)

**Files:**
- Create: `src/server/analysis/semantic-preservation.ts`
- Test: `src/server/analysis/semantic-preservation.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server/analysis/semantic-preservation.test.ts` 생성:

```ts
import { describe, expect, it } from "vitest";
import type { NliClient, NliScores } from "@/server/ai/nli-client";
import type { LocalizedRiskFinding } from "./multilingual";
import { deriveSemanticRelation, enrichSemanticPreservation } from "./semantic-preservation";

function stubClient(scores: NliScores): NliClient {
  return { classify: async () => scores };
}

const baseFinding: LocalizedRiskFinding = {
  id: "f1",
  segmentId: "seg-en-001",
  language: "en",
  originalText: "Guaranteed approval at 4.9% for everyone.",
  literalTranslation: "누구나 4.9% 승인 보장",
  complianceMeaning: "승인 확정처럼 표현합니다.",
  riskCategory: "both",
  riskSignals: ["guaranteed approval"],
  riskLevelHint: "caution",
  suggestedCopyOriginalLanguage: "Approval may vary after review.",
  suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
  confidence: 0.8,
  mqm: {
    errorType: "omission",
    complianceRiskType: "required_disclosure_missing",
    severity: "minor",
    targetSpan: "Guaranteed approval",
    evidenceType: "product_doc",
    recommendedAction: "hold"
  }
};

const review = {
  productDescription: "대출은 신용심사 결과에 따라 승인 여부와 금리가 달라질 수 있습니다.",
  disclosure: "심사 결과에 따라 달라질 수 있음"
};

describe("deriveSemanticRelation", () => {
  it("returns contradiction when contradiction probability dominates", () => {
    const result = deriveSemanticRelation({
      scores: { entailment: 0.1, neutral: 0.2, contradiction: 0.7 },
      premise: review.productDescription,
      hypothesis: "Guaranteed approval for everyone."
    });
    expect(result.relation).toBe("contradiction");
  });

  it("flags overclaim as stronger", () => {
    const result = deriveSemanticRelation({
      scores: { entailment: 0.4, neutral: 0.4, contradiction: 0.2 },
      premise: review.productDescription,
      hypothesis: "Guaranteed approval for everyone."
    });
    expect(result.relation).toBe("stronger");
    expect(result.overclaimTerms).toContain("guaranteed");
  });

  it("flags dropped conditions as missing-condition", () => {
    const result = deriveSemanticRelation({
      scores: { entailment: 0.45, neutral: 0.45, contradiction: 0.1 },
      premise: review.productDescription,
      hypothesis: "Approval at 4.9%."
    });
    expect(result.relation).toBe("missing-condition");
    expect(result.missingConditionTerms.length).toBeGreaterThan(0);
  });

  it("returns equivalent on high entailment with no term drift", () => {
    const result = deriveSemanticRelation({
      scores: { entailment: 0.85, neutral: 0.1, contradiction: 0.05 },
      premise: review.productDescription,
      hypothesis: "Approval and rate depend on credit review."
    });
    expect(result.relation).toBe("equivalent");
  });
});

describe("enrichSemanticPreservation", () => {
  it("attaches semanticPreservation and escalates missing-condition omission", async () => {
    const [enriched] = await enrichSemanticPreservation({
      findings: [baseFinding],
      review,
      client: stubClient({ entailment: 0.2, neutral: 0.5, contradiction: 0.3 })
    });

    expect(enriched.semanticPreservation?.semanticRelation).toBe("stronger");
    expect(enriched.semanticPreservation?.semanticShiftScore).toBeCloseTo(0.8, 5);
    expect(enriched.semanticPreservation?.model).toBe("mDeBERTa-v3-base-mnli-xnli");
    // stronger → recommendedAction stays, but overclaim present
    expect(enriched.mqm?.recommendedAction).toBe("hold");
  });

  it("keeps the original finding when the NLI client throws", async () => {
    const failingClient: NliClient = {
      classify: async () => {
        throw new Error("service down");
      }
    };

    const [enriched] = await enrichSemanticPreservation({
      findings: [baseFinding],
      review,
      client: failingClient
    });

    expect(enriched.semanticPreservation).toBeUndefined();
    expect(enriched.mqm).toEqual(baseFinding.mqm);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- semantic-preservation`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`src/server/analysis/semantic-preservation.ts` 생성:

```ts
import type { NliClient, NliScores } from "@/server/ai/nli-client";
import type {
  LocalizedRiskFinding,
  SemanticPreservation,
  SemanticRelation
} from "./multilingual";

const DEFAULT_MODEL = "mDeBERTa-v3-base-mnli-xnli";

const OVERCLAIM_TERMS = [
  "guaranteed",
  "guarantee",
  "for everyone",
  "everyone",
  "no hidden fees",
  "no fees",
  "instant",
  "lowest",
  "always",
  "보장",
  "누구나",
  "무조건",
  "전원",
  "무료",
  "즉시",
  "최저"
];

const CONDITION_TERMS = [
  "credit review",
  "review",
  "screening",
  "may vary",
  "subject to",
  "depending",
  "eligibility",
  "심사",
  "신용",
  "변동",
  "달라질",
  "조건",
  "자격",
  "기준"
];

function matchedTerms(haystack: string, terms: string[]): string[] {
  const lower = haystack.toLowerCase();
  return terms.filter((term) => lower.includes(term.toLowerCase()));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function deriveSemanticRelation(input: {
  scores: NliScores;
  premise: string;
  hypothesis: string;
}): {
  relation: SemanticRelation;
  missingConditionTerms: string[];
  overclaimTerms: string[];
} {
  const overclaimInHypothesis = matchedTerms(input.hypothesis, OVERCLAIM_TERMS);
  const overclaimInPremise = matchedTerms(input.premise, OVERCLAIM_TERMS);
  const overclaimTerms = overclaimInHypothesis.filter(
    (term) => !overclaimInPremise.includes(term)
  );

  // Cross-lingual: the premise is Korean and the hypothesis is a foreign
  // language, so a per-term intersection never overlaps. Instead treat it as
  // missing-condition only when the source states conditions and the foreign
  // copy states none in its own language.
  const conditionsInPremise = matchedTerms(input.premise, CONDITION_TERMS);
  const conditionsInHypothesis = matchedTerms(input.hypothesis, CONDITION_TERMS);
  const conditionsDropped =
    conditionsInPremise.length > 0 && conditionsInHypothesis.length === 0;
  const missingConditionTerms = conditionsDropped ? conditionsInPremise : [];

  let relation: SemanticRelation;
  if (input.scores.contradiction >= 0.5) {
    relation = "contradiction";
  } else if (overclaimTerms.length > 0) {
    relation = "stronger";
  } else if (conditionsDropped) {
    relation = "missing-condition";
  } else if (input.scores.entailment >= 0.7) {
    relation = "equivalent";
  } else {
    relation = "weaker";
  }

  return { relation, missingConditionTerms, overclaimTerms };
}

function reconcileMqm(finding: LocalizedRiskFinding): LocalizedRiskFinding {
  const relation = finding.semanticPreservation?.semanticRelation;
  if (!finding.mqm || !relation) {
    return finding;
  }

  let mqm = finding.mqm;
  if (relation === "contradiction" || relation === "missing-condition") {
    mqm = { ...mqm, recommendedAction: "change_request" };
  }
  if (relation === "missing-condition" && mqm.errorType === "omission" && mqm.severity === "minor") {
    mqm = { ...mqm, severity: "major" };
  }

  return { ...finding, mqm };
}

export async function enrichSemanticPreservation(input: {
  findings: LocalizedRiskFinding[];
  review: { productDescription?: string; disclosure?: string };
  client: NliClient;
  model?: string;
}): Promise<LocalizedRiskFinding[]> {
  const premise = [input.review.productDescription, input.review.disclosure]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");

  const enriched: LocalizedRiskFinding[] = [];

  for (const finding of input.findings) {
    try {
      const scores = await input.client.classify({
        premise,
        hypothesis: finding.originalText
      });
      const { relation, missingConditionTerms, overclaimTerms } = deriveSemanticRelation({
        scores,
        premise,
        hypothesis: finding.originalText
      });

      const semanticPreservation: SemanticPreservation = {
        semanticRelation: relation,
        semanticShiftScore: clamp01(1 - scores.entailment),
        missingConditionTerms,
        overclaimTerms,
        nliProbabilities: scores,
        model: input.model ?? DEFAULT_MODEL
      };

      enriched.push(reconcileMqm({ ...finding, semanticPreservation }));
    } catch {
      enriched.push(finding);
    }
  }

  return enriched;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- semantic-preservation`
Expected: PASS (전체 통과)

- [ ] **Step 5: Commit**

```bash
git add src/server/analysis/semantic-preservation.ts src/server/analysis/semantic-preservation.test.ts
git commit -m "feat(multilingual): derive semantic-preservation fields from NLI scores"
```

---

## Task 6: 파이프라인 배선 + degradation

**Files:**
- Modify: `src/server/analysis/multilingual-risk-team.ts` (`runMultilingualRiskTeam` input + enrich 호출, 471-518)
- Modify: `src/server/analysis/review-analysis-pipeline.ts` (`runMultilingualRiskTeam` 호출부, ~1634-1645)
- Test: `src/server/analysis/multilingual-risk-team.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server/analysis/multilingual-risk-team.test.ts`에 추가:

```ts
it("enriches findings with semanticPreservation when an nli client is supplied", async () => {
  const provider = providerReturning({
    english_translator_risk: JSON.stringify({
      findings: [
        {
          segmentId: "seg-en-001",
          language: "en",
          complianceMeaning: "승인 확정처럼 표현합니다.",
          riskCategory: "both",
          riskSignals: ["guaranteed approval"],
          riskLevelHint: "caution",
          suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
          confidence: 0.8,
          mqm: {
            errorType: "omission",
            complianceRiskType: "required_disclosure_missing",
            severity: "minor",
            targetSpan: "Guaranteed approval",
            evidenceType: "product_doc",
            recommendedAction: "hold"
          }
        }
      ]
    }),
    korean_compliance_mapping: JSON.stringify({ mappings: [] })
  });

  const result = await runMultilingualRiskTeam({
    review,
    segments: segmentMultilingualDocuments([
      document("대출 광고\nGuaranteed approval in 3 minutes\n금리는 심사 후 확정")
    ]),
    evidenceCandidates: [],
    provider,
    nliClient: { classify: async () => ({ entailment: 0.1, neutral: 0.2, contradiction: 0.7 }) }
  });

  expect(result.localizedRiskFindings[0]?.semanticPreservation?.semanticRelation).toBe("contradiction");
  expect(result.localizedRiskFindings[0]?.mqm?.recommendedAction).toBe("change_request");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- multilingual-risk-team`
Expected: FAIL — `nliClient`는 알려지지 않은 속성 / semanticPreservation undefined

- [ ] **Step 3: import 추가**

`src/server/analysis/multilingual-risk-team.ts` 상단 import 블록에 추가:

```ts
import type { NliClient } from "@/server/ai/nli-client";
import { enrichSemanticPreservation } from "./semantic-preservation";
```

- [ ] **Step 4: 함수 시그니처에 nliClient 추가**

`runMultilingualRiskTeam` input 타입(471-476줄)에 `nliClient` 추가:

```ts
export async function runMultilingualRiskTeam(input: {
  review: ReviewCase;
  segments: MultilingualSegment[];
  evidenceCandidates: RagEvidenceCandidate[];
  provider: ModelProvider;
  nliClient?: NliClient;
}): Promise<MultilingualRiskTeamResult> {
```

- [ ] **Step 5: enrich 호출 삽입**

언어 루프가 끝나는 518줄(`}` 닫힘) **뒤**, `if (localizedRiskFindings.length === 0) {`(520줄) **앞**에 삽입:

```ts
  if (input.nliClient && localizedRiskFindings.length > 0) {
    try {
      const enriched = await enrichSemanticPreservation({
        findings: localizedRiskFindings,
        review: input.review,
        client: input.nliClient
      });
      localizedRiskFindings.splice(0, localizedRiskFindings.length, ...enriched);
    } catch (error) {
      errors.push({
        agentType: "korean_compliance_mapping",
        message: `nli_enrichment_failed: ${errorMessage(error)}`
      });
    }
  }
```

- [ ] **Step 6: 파이프라인에서 클라이언트 주입**

`src/server/analysis/review-analysis-pipeline.ts`에서 `runMultilingualRiskTeam({` 호출부를 grep으로 찾는다:

Run: `grep -n "runMultilingualRiskTeam({" src/server/analysis/review-analysis-pipeline.ts`

파일 상단 import 영역에 추가:

```ts
import { createHttpNliClient } from "@/server/ai/nli-client";
```

`runMultilingualRiskTeam({ ... provider: modelProvider })` 호출을 다음으로 교체 (기존 인자 유지하고 `nliClient`만 추가):

```ts
        await runMultilingualRiskTeam({
          review,
          segments: multilingualSegments,
          evidenceCandidates,
          provider: modelProvider,
          nliClient:
            process.env.FINPROOF_NLI_ENABLED === "true" && process.env.FINPROOF_NLI_URL
              ? createHttpNliClient({ baseUrl: process.env.FINPROOF_NLI_URL })
              : undefined
        })
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npm run test -- multilingual-risk-team`
Expected: PASS

- [ ] **Step 8: 전체 타입 체크 + 테스트**

Run: `npx tsc --noEmit && npm run test -- multilingual`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/server/analysis/multilingual-risk-team.ts src/server/analysis/review-analysis-pipeline.ts src/server/analysis/multilingual-risk-team.test.ts
git commit -m "feat(multilingual): wire NLI enrichment into risk team behind FINPROOF_NLI_ENABLED"
```

---

## Task 6b: MultilingualIssueContext 캐리스루 (finding → 이슈 카드 → DB 왕복)

신규 `semanticPreservation`/`mqm` 값을 (1) 분석 파이프라인의 forward 투영(`multilingualContextFromFinding`)과 (2) DB 스냅샷 복원(`multilingualContextFromSnapshot`) 양쪽에서 이슈 컨텍스트로 통과시킨다. 두 경로 모두 optional이므로 기존 필수 필드 가드는 건드리지 않는다.

**Files:**
- Modify: `src/server/analysis/issue-generation.ts:228-241` (`multilingualContextFromFinding`)
- Modify: `src/server/reviews/prisma-mappers.ts:151-199` (`multilingualContextFromSnapshot`)
- Test: `src/server/analysis/issue-generation.test.ts`
- Test: `src/server/reviews/prisma-mappers.test.ts`

- [ ] **Step 1: forward 투영 실패 테스트 추가**

`src/server/analysis/issue-generation.test.ts`의 `describe("issue generation", ...)` 안에 새 테스트 추가. 첫 테스트 fixture를 재사용하되 finding에 신규 필드를 넣는다:

```ts
it("carries semanticPreservation and mqm onto the multilingual context", () => {
  const review = getReviewCaseById("rc-demo-loan-001")!;
  const artifacts: AnalysisArtifacts = {
    generatedAt: "2026-05-26T00:00:00.000Z",
    extractedDocuments: [
      {
        fileId: "file-loan-poster",
        fileName: "loan-poster.txt",
        text: "Guaranteed approval in 3 minutes",
        confidence: 0.95,
        provider: "fixture"
      }
    ],
    evidenceCandidates: [
      {
        id: "ev-approval",
        sourceType: "product_doc",
        title: "loan-poster.txt",
        quoteSummary: "Guaranteed approval in 3 minutes",
        relevanceScore: 0.93,
        sourceFileId: "file-loan-poster"
      }
    ],
    agentFindings: [
      {
        id: "finding-multilingual-002",
        agent: "korean_compliance_mapping",
        issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
        riskLevel: "high",
        title: "승인 보장 오인 표현",
        targetText: "Guaranteed approval in 3 minutes",
        description: "심사와 무관하게 승인이 확정되는 것처럼 해석될 수 있음",
        suggestedAction: "change_request",
        suggestedCopy: "Apply in 3 minutes. Approval is subject to credit review.",
        evidenceCandidateIds: ["ev-approval"],
        confidence: 0.91,
        localizedRiskFinding: {
          id: "risk-en-approval",
          segmentId: "seg-en-001",
          language: "en",
          originalText: "Guaranteed approval in 3 minutes",
          literalTranslation: "3분 안에 승인 보장",
          complianceMeaning: "심사와 무관하게 승인 확정처럼 해석될 수 있음",
          riskCategory: "both",
          riskSignals: ["approval_guarantee"],
          riskLevelHint: "high",
          suggestedCopyOriginalLanguage:
            "Apply in 3 minutes. Approval is subject to credit review.",
          suggestedCopyKoreanMeaning:
            "3분 신청 가능. 승인은 신용심사 결과에 따라 달라질 수 있음.",
          confidence: 0.91,
          semanticPreservation: {
            semanticRelation: "stronger",
            semanticShiftScore: 0.8,
            missingConditionTerms: [],
            overclaimTerms: ["guaranteed"],
            nliProbabilities: { entailment: 0.2, neutral: 0.5, contradiction: 0.3 },
            model: "mDeBERTa-v3-base-mnli-xnli"
          },
          mqm: {
            errorType: "addition",
            complianceRiskType: "approval_guarantee",
            severity: "major",
            targetSpan: "Guaranteed approval",
            evidenceType: "product_doc",
            recommendedAction: "change_request"
          }
        },
        koreanComplianceMapping: {
          localizedFindingId: "risk-en-approval",
          issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
          koreanComplianceCategory: "승인 보장 오인 표현",
          koreanComplianceReason: "대출 승인 가능성을 확정적으로 고지하는 표현으로 볼 수 있음",
          evidenceQuery: "대출 광고 승인 보장 금지 표현",
          suggestedAction: "change_request"
        }
      }
    ]
  };

  const issues = buildAnalysisIssues(review, artifacts);

  expect(issues[0].multilingualContext?.semanticPreservation).toEqual({
    semanticRelation: "stronger",
    semanticShiftScore: 0.8,
    missingConditionTerms: [],
    overclaimTerms: ["guaranteed"],
    nliProbabilities: { entailment: 0.2, neutral: 0.5, contradiction: 0.3 },
    model: "mDeBERTa-v3-base-mnli-xnli"
  });
  expect(issues[0].multilingualContext?.mqm).toEqual({
    errorType: "addition",
    complianceRiskType: "approval_guarantee",
    severity: "major",
    targetSpan: "Guaranteed approval",
    evidenceType: "product_doc",
    recommendedAction: "change_request"
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- issue-generation`
Expected: FAIL — `semanticPreservation`/`mqm`가 undefined

- [ ] **Step 3: forward 투영에 passthrough 추가**

`src/server/analysis/issue-generation.ts`의 `multilingualContextFromFinding` return 객체(228-241줄)에서 `suggestedCopyKoreanMeaning: localized.suggestedCopyKoreanMeaning` 줄을 다음으로 교체:

```ts
    suggestedCopyOriginalLanguage: localized.suggestedCopyOriginalLanguage,
    suggestedCopyKoreanMeaning: localized.suggestedCopyKoreanMeaning,
    semanticPreservation: localized.semanticPreservation,
    mqm: localized.mqm
```

(주의: 위에서 `suggestedCopyOriginalLanguage` 줄은 이미 존재하므로 중복 추가하지 말고, `suggestedCopyKoreanMeaning` 줄 뒤에 두 줄만 append하면 된다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- issue-generation`
Expected: PASS (기존 `toEqual` 테스트는 undefined 필드를 동등 취급하므로 무손상)

- [ ] **Step 5: 스냅샷 복원 실패 테스트 추가**

`src/server/reviews/prisma-mappers.test.ts`의 `row` fixture(51-76줄 `outputSnapshot.localizedRiskFinding`)에 신규 필드를 추가한다. `confidence: 0.91` 줄 뒤에 삽입:

```ts
            confidence: 0.91,
            semanticPreservation: {
              semanticRelation: "stronger",
              semanticShiftScore: 0.8,
              missingConditionTerms: [],
              overclaimTerms: ["guaranteed"],
              nliProbabilities: { entailment: 0.2, neutral: 0.5, contradiction: 0.3 },
              model: "mDeBERTa-v3-base-mnli-xnli"
            },
            mqm: {
              errorType: "addition",
              complianceRiskType: "approval_guarantee",
              severity: "major",
              targetSpan: "Guaranteed approval",
              evidenceType: "product_doc",
              recommendedAction: "change_request"
            }
```

그리고 `describe("prisma review mappers", ...)` 안에 새 테스트 추가:

```ts
it("reconstructs semanticPreservation and mqm from the stored snapshot", () => {
  const mapped = toReviewCase(row);
  expect(mapped.issues[0]?.multilingualContext?.semanticPreservation).toEqual({
    semanticRelation: "stronger",
    semanticShiftScore: 0.8,
    missingConditionTerms: [],
    overclaimTerms: ["guaranteed"],
    nliProbabilities: { entailment: 0.2, neutral: 0.5, contradiction: 0.3 },
    model: "mDeBERTa-v3-base-mnli-xnli"
  });
  expect(mapped.issues[0]?.multilingualContext?.mqm).toEqual({
    errorType: "addition",
    complianceRiskType: "approval_guarantee",
    severity: "major",
    targetSpan: "Guaranteed approval",
    evidenceType: "product_doc",
    recommendedAction: "change_request"
  });
});
```

(참고: `toReviewCase`가 이미 import되어 있는지 확인. 없으면 파일 상단 import에서 이미 쓰는 매퍼 이름을 grep으로 확인: `grep -n "toReviewCase" src/server/reviews/prisma-mappers.test.ts`.)

- [ ] **Step 6: 테스트 실패 확인**

Run: `npm run test -- prisma-mappers`
Expected: FAIL — `semanticPreservation`/`mqm`가 undefined

- [ ] **Step 7: 스냅샷 파서 헬퍼 추가**

`src/server/reviews/prisma-mappers.ts`의 `multilingualContextFromSnapshot`(151줄) **바로 위**에 삽입:

```ts
const SEMANTIC_RELATIONS = [
  "equivalent",
  "stronger",
  "weaker",
  "contradiction",
  "missing-condition"
] as const;
const MQM_ERROR_TYPES = [
  "mistranslation",
  "omission",
  "addition",
  "terminology",
  "inconsistency",
  "locale_convention"
] as const;
const MQM_SEVERITIES = ["minor", "major", "critical"] as const;
const MQM_EVIDENCE_TYPES = ["product_doc", "internal_policy", "law", "case_history"] as const;
const SUGGESTED_ACTIONS = ["approve", "change_request", "reject", "hold"] as const;

function numberOr(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function semanticPreservationValue(
  value: unknown
): MultilingualIssueContext["semanticPreservation"] {
  const obj = objectValue(value);
  const probs = objectValue(obj?.nliProbabilities);
  const relation = stringValue(obj?.semanticRelation);

  if (!obj || !probs || !relation || !SEMANTIC_RELATIONS.includes(relation as never)) {
    return undefined;
  }

  return {
    semanticRelation: relation as (typeof SEMANTIC_RELATIONS)[number],
    semanticShiftScore: numberOr(obj.semanticShiftScore),
    missingConditionTerms: stringArray(obj.missingConditionTerms),
    overclaimTerms: stringArray(obj.overclaimTerms),
    nliProbabilities: {
      entailment: numberOr(probs.entailment),
      neutral: numberOr(probs.neutral),
      contradiction: numberOr(probs.contradiction)
    },
    model: stringValue(obj.model) ?? ""
  };
}

function mqmValue(value: unknown): MultilingualIssueContext["mqm"] {
  const obj = objectValue(value);
  const errorType = stringValue(obj?.errorType);
  const severity = stringValue(obj?.severity);
  const evidenceType = stringValue(obj?.evidenceType);
  const action = stringValue(obj?.recommendedAction);

  if (
    !obj ||
    !errorType ||
    !MQM_ERROR_TYPES.includes(errorType as never) ||
    !severity ||
    !MQM_SEVERITIES.includes(severity as never) ||
    !evidenceType ||
    !MQM_EVIDENCE_TYPES.includes(evidenceType as never)
  ) {
    return undefined;
  }

  return {
    errorType: errorType as (typeof MQM_ERROR_TYPES)[number],
    complianceRiskType: stringValue(obj.complianceRiskType) ?? "",
    severity: severity as (typeof MQM_SEVERITIES)[number],
    targetSpan: stringValue(obj.targetSpan) ?? "",
    evidenceType: evidenceType as (typeof MQM_EVIDENCE_TYPES)[number],
    recommendedAction:
      action && SUGGESTED_ACTIONS.includes(action as never)
        ? (action as (typeof SUGGESTED_ACTIONS)[number])
        : "hold"
  };
}
```

- [ ] **Step 8: 복원 return에 passthrough 추가**

같은 파일 `multilingualContextFromSnapshot`의 최종 return 객체(185-198줄)에서 `suggestedCopyKoreanMeaning` 줄을 다음으로 교체:

```ts
    suggestedCopyOriginalLanguage,
    suggestedCopyKoreanMeaning,
    semanticPreservation: semanticPreservationValue(localized?.semanticPreservation),
    mqm: mqmValue(localized?.mqm)
```

(주의: `suggestedCopyOriginalLanguage`는 이미 존재하므로 `suggestedCopyKoreanMeaning` 뒤에 두 줄만 append.)

- [ ] **Step 9: 테스트 통과 확인**

Run: `npm run test -- prisma-mappers`
Expected: PASS (기존 `toMatchObject` 테스트 무손상)

- [ ] **Step 10: Commit**

```bash
git add src/server/analysis/issue-generation.ts src/server/analysis/issue-generation.test.ts src/server/reviews/prisma-mappers.ts src/server/reviews/prisma-mappers.test.ts
git commit -m "feat(multilingual): carry semanticPreservation and mqm through issue context and snapshot round-trip"
```

---

## Task 7: Python NLI 마이크로서비스

**Files:**
- Create: `services/nli/app.py`
- Create: `services/nli/requirements.txt`
- Create: `services/nli/test_nli.py`
- Create: `services/nli/finproof-nli.service`
- Create: `services/nli/README.md`

- [ ] **Step 1: requirements 작성**

`services/nli/requirements.txt`:

```
fastapi==0.115.6
uvicorn==0.34.0
transformers==4.48.0
torch==2.5.1
sentencepiece==0.2.0
pytest==8.3.4
httpx==0.28.1
```

- [ ] **Step 2: 실패하는 테스트 작성**

`services/nli/test_nli.py`:

```python
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200


def test_nli_contradiction_direction():
    response = client.post(
        "/nli",
        json={
            "premise": "신용심사 결과에 따라 승인 여부 및 금리는 달라질 수 있습니다.",
            "hypothesis": "Guaranteed approval at 4.9% for everyone.",
        },
    )
    assert response.status_code == 200
    scores = response.json()["scores"]
    assert set(scores) == {"entailment", "neutral", "contradiction"}
    # 과장/모순 방향이므로 contradiction이 entailment보다 커야 한다.
    assert scores["contradiction"] > scores["entailment"]
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd services/nli && python -m pytest -q`
Expected: FAIL — `app` 모듈 없음

- [ ] **Step 4: 서비스 구현**

`services/nli/app.py`:

```python
from functools import lru_cache

import torch
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODEL_NAME = "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli"

app = FastAPI(title="finproof-nli")


class NliRequest(BaseModel):
    premise: str
    hypothesis: str


@lru_cache(maxsize=1)
def _model():
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
    model.eval()
    return tokenizer, model


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/nli")
def nli(request: NliRequest):
    tokenizer, model = _model()
    inputs = tokenizer(
        request.premise,
        request.hypothesis,
        truncation=True,
        return_tensors="pt",
        max_length=512,
    )
    with torch.no_grad():
        logits = model(**inputs).logits[0]
    probs = torch.softmax(logits, dim=-1).tolist()

    # mDeBERTa-v3-base-mnli-xnli label order: 0=entailment, 1=neutral, 2=contradiction
    label_map = model.config.id2label
    scores = {label_map[i].lower(): float(probs[i]) for i in range(len(probs))}

    return {
        "scores": {
            "entailment": scores.get("entailment", 0.0),
            "neutral": scores.get("neutral", 0.0),
            "contradiction": scores.get("contradiction", 0.0),
        }
    }
```

- [ ] **Step 5: 테스트 통과 확인 (모델 다운로드 필요, 최초 1회)**

Run: `cd services/nli && pip install -r requirements.txt && python -m pytest -q`
Expected: PASS (최초 실행은 모델 다운로드로 수 분 소요)

- [ ] **Step 6: systemd 유닛 + README 작성**

`services/nli/finproof-nli.service`:

```ini
[Unit]
Description=FinProof NLI (mDeBERTa) service
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ec2-user/FinProof/services/nli
ExecStart=/home/ec2-user/FinProof/services/nli/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8001
Restart=on-failure
Environment=OMP_NUM_THREADS=2

[Install]
WantedBy=multi-user.target
```

`services/nli/README.md`:

```markdown
# finproof-nli

mDeBERTa-v3-base-mnli-xnli 기반 cross-lingual NLI 서비스. `enrichSemanticPreservation()`가 호출한다.

## 로컬 실행
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app:app --host 127.0.0.1 --port 8001

## API
- `GET /health`
- `POST /nli` — body `{ premise, hypothesis }` → `{ scores: { entailment, neutral, contradiction } }`

## 배포 (EC2, finproof-ocr 패턴)
    sudo cp finproof-nli.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now finproof-nli
    curl -s localhost:8001/health

앱 쪽 활성화: `FINPROOF_NLI_ENABLED=true`, `FINPROOF_NLI_URL=http://127.0.0.1:8001`.
```

- [ ] **Step 7: Commit**

```bash
git add services/nli
git commit -m "feat(nli): add mDeBERTa FastAPI microservice with systemd unit"
```

---

## Task 8: env 문서화 + 최종 검증

**Files:**
- Modify: `.env.example` (없으면 확인 후 생성 건너뜀)

- [ ] **Step 1: env 예시 추가**

`.env.example`가 존재하면 다음 줄을 추가(존재하지 않으면 이 스텝 건너뜀):

```
# 다국어 NLI 의미보존 검증 (mDeBERTa). 서비스 미기동 시 false로 두면 기존 동작 유지.
FINPROOF_NLI_ENABLED=false
FINPROOF_NLI_URL=http://127.0.0.1:8001
```

- [ ] **Step 2: 전체 타입 체크 + 테스트 + 린트**

Run: `npx tsc --noEmit && npm run test && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(nli): document FINPROOF_NLI_ENABLED and FINPROOF_NLI_URL"
```

---

## 검증 체크리스트 (수동, 배포 후)

- [ ] EC2에 `finproof-nli` 기동, `curl localhost:8001/health` 200 확인.
- [ ] prod env에 `FINPROOF_NLI_ENABLED=true`, `FINPROOF_NLI_URL` 설정 후 다국어 테스트 케이스 재분석.
- [ ] 이슈 카드의 `MultilingualIssueContext`에 `semanticPreservation`, `mqm`이 부착되는지 확인.
- [ ] NLI 서비스를 내린 상태에서 재분석 시 분석이 실패 없이 완료되는지(degradation) 확인.
