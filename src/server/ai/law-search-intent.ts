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
