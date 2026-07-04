import type { AnalysisEventRecord } from "@/server/reviews/review-store";

export type ProgressLine = {
  id: string;
  seq: number;
  state: "running" | "done" | "info" | "error";
  text: string;
  evidence?: string[];
};

const AGENT_LABELS: Record<string, string> = {
  creative_review: "광고 표현 심의",
  product_terms: "상품 조건 확인",
  regulation: "규정 위반 검토",
  internal_policy: "내부 지침 검토",
  social_context_risk: "사회적 맥락 리스크 검토",
  evidence_verification: "근거 검증",
  case_search: "유사 사례 탐색",
  main: "최종 종합 판단"
};

const MAX_CHIPS = 5;

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Reduce a raw evidence title to something a reviewer can read at a glance:
 * strip archive/directory nesting (e.g. "a.zip/a.zip/poster.png" -> "poster.png")
 * and any file extension, keeping human-authored knowledge titles unchanged.
 */
function cleanTitle(title: string): string {
  const base = title.split("/").pop()?.trim();
  if (!base) return title;
  return base.replace(/\.(zip|png|jpe?g|pdf|docx?|txt|hwp|pptx?|xlsx?)$/i, "");
}

function cleanTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const title of titles) {
    const label = cleanTitle(title);
    if (label && !seen.has(label)) {
      seen.add(label);
      cleaned.push(label);
    }
    if (cleaned.length >= MAX_CHIPS) break;
  }
  return cleaned;
}

function titlesFrom(topDocs: unknown): string[] {
  if (!Array.isArray(topDocs)) return [];
  const titles = topDocs
    .map((doc) => (doc && typeof doc === "object" ? (doc as { title?: unknown }).title : undefined))
    .filter((title): title is string => typeof title === "string");
  return cleanTitles(titles);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const titles = cleanTitles(
    value.filter((item): item is string => typeof item === "string")
  );
  return titles.length > 0 ? titles : undefined;
}

/**
 * Pure mapping from a persisted analysis event to a reviewer-facing line.
 * Any unknown stage/agent falls back to a safe generic line (never throws).
 */
export function describeAnalysisEvent(event: AnalysisEventRecord): ProgressLine {
  const base = { id: event.id, seq: event.seq };
  const p = event.payload as Record<string, unknown>;
  const key = `${event.stage}:${event.event}`;

  switch (key) {
    case "pipeline:start":
      return { ...base, state: "info", text: "심의를 시작합니다" };
    case "ocr:done":
      return { ...base, state: "done", text: `첨부 ${num(p.docs) ?? 0}건에서 내용을 읽었어요` };
    case "query_expansion:done":
      return { ...base, state: "done", text: "핵심 개념을 뽑아 관련 규정을 찾을 준비를 했어요" };
    case "rag_retrieve:done":
      return {
        ...base,
        state: "done",
        text: `관련 규정·사례 후보 ${num(p.candidates) ?? 0}건을 찾았어요`
      };
    case "rerank:done":
      return {
        ...base,
        state: "done",
        text: "가장 관련 높은 근거를 선별했어요",
        evidence: titlesFrom(p.topDocs)
      };
    case "evidence_select:done":
      return {
        ...base,
        state: "done",
        text: `심사 근거 ${num(p.selected) ?? 0}건을 확정했어요`,
        evidence: stringList(p.titles)
      };
    case "orchestrate:start":
      return { ...base, state: "info", text: "전문 에이전트들이 검토를 시작해요" };
    case "combine:done":
      return {
        ...base,
        state: "done",
        text: `분석 완료 — 총 ${num(p.agentFindings) ?? 0}개 항목을 도출했어요`
      };
    case "social_context_kg:done": {
      const referenced = Array.isArray(p.matchedNodeIds) ? p.matchedNodeIds.length : 0;
      return {
        ...base,
        state: "done",
        text: `사회맥락 지식그래프에서 노드 ${referenced}개를 참조했어요`
      };
    }
    case "cove:start":
      return { ...base, state: "running", text: "검토 결과를 근거와 교차 검증하고 있어요…" };
    case "cove:done": {
      const verified = num(p.verified) ?? 0;
      const suppressed = num(p.suppressed) ?? 0;
      const suffix = suppressed > 0 ? `, ${suppressed}건 근거부족으로 보류·제외` : "";
      return { ...base, state: "done", text: `교차 검증 완료 — ${verified}건 재확인${suffix}` };
    }
    default:
      break;
  }

  if (event.stage === "subagent") {
    const label = AGENT_LABELS[String(p.agent ?? "")] ?? "에이전트 검토";
    if (event.event === "start") {
      return { ...base, state: "running", text: `${label} 중이에요…` };
    }
    const findings = num(p.findings) ?? 0;
    return { ...base, state: "done", text: `${label} 완료 — ${findings}건 확인` };
  }

  return { ...base, state: "info", text: "분석을 진행하고 있어요" };
}

/**
 * Turn the raw event stream into display lines. Stages that emit a `start`
 * (spinner) and a later `done` (check) — sub-agents and cross-verification —
 * drop their `start` line once the matching `done` has arrived, so a finished
 * step never keeps spinning. Steps that have started but not finished still
 * show their spinner.
 */
export function buildProgressLines(events: AnalysisEventRecord[]): ProgressLine[] {
  const finishedAgents = new Set<string>();
  let coveFinished = false;
  for (const event of events) {
    if (event.stage === "subagent" && event.event === "done") {
      const agent = String((event.payload as Record<string, unknown>).agent ?? "");
      if (agent) finishedAgents.add(agent);
    }
    if (event.stage === "cove" && event.event === "done") {
      coveFinished = true;
    }
  }

  const lines: ProgressLine[] = [];
  for (const event of events) {
    if (event.stage === "subagent" && event.event === "start") {
      const agent = String((event.payload as Record<string, unknown>).agent ?? "");
      if (agent && finishedAgents.has(agent)) {
        continue;
      }
    }
    if (event.stage === "cove" && event.event === "start" && coveFinished) {
      continue;
    }
    // The social-context KG engine emits a granular per-phase trace for the live
    // graph viewer; in the reviewer popup we collapse those to the single summary line.
    if (event.stage === "social_context_kg" && event.event !== "done") {
      continue;
    }
    lines.push(describeAnalysisEvent(event));
  }
  return lines;
}
