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
