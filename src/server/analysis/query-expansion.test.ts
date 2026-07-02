import { describe, expect, it, vi } from "vitest";
import { expandComplianceQuery } from "./query-expansion";

const modelProvider = (text: string) => ({
  generateText: vi.fn(async () => ({ provider: "openai" as const, model: "gpt", text }))
});

describe("expandComplianceQuery", () => {
  it("returns compliance concept terms for an ad", async () => {
    const provider = modelProvider("한정판매 선착순 희소성 오인유도 마감임박");
    const result = await expandComplianceQuery("긴급특판! 한도 소진 시 조기 종료!", provider);
    expect(result).toContain("한정판매");
    expect(result).toContain("선착순");
  });

  it("returns empty string when the ad text is blank", async () => {
    const provider = modelProvider("무시됨");
    expect(await expandComplianceQuery("   ", provider)).toBe("");
    expect(provider.generateText).not.toHaveBeenCalled();
  });

  it("falls back to empty string when the model call throws", async () => {
    const provider = { generateText: vi.fn(async () => { throw new Error("timeout"); }) };
    expect(await expandComplianceQuery("긴급특판", provider)).toBe("");
  });

  it("falls back to empty string when the model returns nothing usable", async () => {
    const provider = modelProvider("   ");
    expect(await expandComplianceQuery("긴급특판", provider)).toBe("");
  });

  it("normalizes whitespace and strips list punctuation from the model output", async () => {
    const provider = modelProvider("- 한정판매,\n- 선착순 ;  희소성");
    const result = await expandComplianceQuery("긴급특판", provider);
    expect(result).toBe("한정판매 선착순 희소성");
  });
});
