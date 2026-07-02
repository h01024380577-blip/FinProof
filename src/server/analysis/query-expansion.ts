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
