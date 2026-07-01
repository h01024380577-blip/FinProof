import {
  LAW_SEARCH_INTENT_PROMPT,
  multilingualTranslatorRiskPrompt,
  RAG_CHAT_PROMPT
} from "./prompt-registry";

describe("prompt registry", () => {
  it("gives multilingual translator risk agents concrete translation and compliance duties", () => {
    const prompt = multilingualTranslatorRiskPrompt("vi");

    expect(prompt).toContain(
      "You are the FinProof vietnamese_translator_risk agent for Korean financial advertising review."
    );
    expect(prompt).toContain(
      "Preserve original-language nuance before translating the segment into Korean reviewer context."
    );
    expect(prompt).toContain("literalTranslation");
    expect(prompt).toContain("complianceMeaning");
    expect(prompt).toContain("riskSignals");
    expect(prompt).toContain("suggestedCopyOriginalLanguage");
    expect(prompt).toContain("suggestedCopyKoreanMeaning");
    expect(prompt).toContain("Do not create a finding unless the segment contains financial-advertising copy");
    expect(prompt).toContain("Common Risk Policy");
  });
});

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
