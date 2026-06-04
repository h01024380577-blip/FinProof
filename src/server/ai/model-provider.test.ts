import { createModelProvider, extractGeminiText, extractOpenAIText } from "./model-provider";

describe("model provider", () => {
  it("uses deterministic generation by default", async () => {
    const provider = createModelProvider({}, fetch);
    const result = await provider.generateText({
      task: "draft",
      instructions: "Write a draft",
      input: "review",
      fallback: "deterministic draft"
    });

    expect(result).toEqual({
      provider: "deterministic",
      model: "deterministic",
      text: "deterministic draft"
    });
  });

  it("constructs OpenAI Responses API requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "model generated text" })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test",
        OPENAI_MODEL: "gpt-5.2"
      },
      fetchMock
    );

    const result = await provider.generateText({
      task: "chat",
      instructions: "Answer with evidence",
      input: "question",
      fallback: "fallback answer"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer sk-test",
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          model: "gpt-5.2",
          instructions: "Answer with evidence",
          input: "question"
        })
      })
    );
    expect(result).toEqual({
      provider: "openai",
      model: "gpt-5.2",
      text: "model generated text"
    });
  });

  it("disables Gemini for non-OCR model generation", async () => {
    const fetchMock = vi.fn();
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-test",
        GEMINI_MODEL: "gemini-2.5-flash"
      },
      fetchMock
    );

    await expect(
      provider.generateText({
        task: "chat",
        instructions: "Answer with evidence",
        input: "question",
        fallback: "fallback answer"
      })
    ).rejects.toThrow("Gemini is only allowed for OCR");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes text tasks through the Obsidian model baseline", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "routed text" })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "router",
        OPENAI_API_KEY: "sk-test"
      },
      fetchMock
    );

    const result = await provider.generateText({
      task: "rag_chat",
      routeContext: { riskLevel: "high" },
      instructions: "Answer with evidence",
      input: "question",
      fallback: "fallback answer"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        body: JSON.stringify({
          model: "gpt-5.4",
          instructions: "Answer with evidence",
          input: "question"
        })
      })
    );
    expect(result).toMatchObject({
      provider: "openai",
      model: "gpt-5.4",
      modelTier: "escalation_text",
      escalationReason: "risk_level_high",
      text: "routed text"
    });
  });

  it("routes multimodal tasks through OpenAI escalation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "visual analysis" })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "router",
        OPENAI_API_KEY: "sk-test"
      },
      fetchMock
    );

    const result = await provider.generateText({
      task: "ocr_visual_understanding",
      routeContext: { complexVisual: true },
      instructions: "Read image",
      input: "image payload",
      fallback: "fallback visual"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        body: JSON.stringify({
          model: "gpt-5.4",
          instructions: "Read image",
          input: "image payload"
        })
      })
    );
    expect(result).toMatchObject({
      provider: "openai",
      model: "gpt-5.4",
      modelTier: "escalation_text",
      escalationReason: "complex_visual",
      text: "visual analysis"
    });
  });

  it("extracts output text from raw OpenAI output arrays", () => {
    expect(
      extractOpenAIText({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "nested text" }]
          }
        ]
      })
    ).toBe("nested text");
  });

  it("extracts text from Gemini candidates", () => {
    expect(
      extractGeminiText({
        candidates: [
          {
            content: {
              parts: [{ text: "candidate text" }]
            }
          }
        ]
      })
    ).toBe("candidate text");
  });
});

describe("model provider fetch timeouts", () => {
  it("passes AbortSignal to OpenAI responses fetch", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { output_text: "결과" };
        }
      };
    });

    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        FINPROOF_MODEL_TIMEOUT_MS: "5000"
      },
      fetchImpl
    );

    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    await provider.generateText({ task: "draft", instructions: "sys", input: "user", fallback: "" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    timeoutSpy.mockRestore();
  });
});
