import { multilingualTranslatorRiskPrompt } from "./prompt-registry";

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
