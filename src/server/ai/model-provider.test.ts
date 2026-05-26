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

  it("constructs Gemini generateContent requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "gemini generated text" }]
            }
          }
        ]
      })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-test",
        GEMINI_MODEL: "gemini-2.5-flash"
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
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-goog-api-key": "gemini-test"
        }),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "Answer with evidence" }]
          },
          contents: [{ parts: [{ text: "question" }] }]
        })
      })
    );
    expect(result).toEqual({
      provider: "gemini",
      model: "gemini-2.5-flash",
      text: "gemini generated text"
    });
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

  it("routes multimodal tasks through Gemini escalation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "visual analysis" }] } }]
      })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "router",
        GEMINI_API_KEY: "gemini-test"
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
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
      expect.any(Object)
    );
    expect(result).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-pro",
      modelTier: "multimodal_escalation",
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
