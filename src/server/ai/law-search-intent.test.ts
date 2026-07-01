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

  it("does not treat a bare article-reference judgment question as law_search", () => {
    expect(prefilterLawSearchIntent("어떤 조항 위반인지 알려주세요")).toBe("ambiguous");
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

  it("short-circuits on a confident none prefilter without calling the model", async () => {
    const model = provider("LAW_SEARCH");
    const result = await classifyLawSearchIntent("이 배너 문구 더 짧게 다듬어줘", model);
    expect(result).toBe("none");
    expect(model.generateText).not.toHaveBeenCalled();
  });
});
