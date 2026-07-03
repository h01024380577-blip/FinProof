import {
  createModelProvider,
  extractAnthropicText,
  extractGeminiText,
  extractOpenAIText
} from "./model-provider";

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

  it("constructs Anthropic Messages API requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "model generated text" }] })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "sk-ant-test",
        ANTHROPIC_MODEL: "claude-sonnet-4-6"
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
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-test",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 64000,
          system: "Answer with evidence",
          messages: [{ role: "user", content: "question" }]
        })
      })
    );
    expect(result).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      text: "model generated text"
    });
  });

  it("defaults max_tokens to each model's maximum output", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "긴 초안" }] })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "sk-ant-test",
        ANTHROPIC_MODEL: "claude-opus-4-8"
      },
      fetchMock
    );

    await provider.generateText({
      task: "opinion_draft",
      instructions: "Write a draft",
      input: "context",
      fallback: "fallback"
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { max_tokens: number };
    expect(body.max_tokens).toBe(128000);
  });

  it("lets FINPROOF_MODEL_MAX_TOKENS override the model default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "짧은 답" }] })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "sk-ant-test",
        ANTHROPIC_MODEL: "claude-sonnet-4-6",
        FINPROOF_MODEL_MAX_TOKENS: "1000"
      },
      fetchMock
    );

    await provider.generateText({
      task: "chat",
      instructions: "Answer",
      input: "q",
      fallback: "fb"
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { max_tokens: number };
    expect(body.max_tokens).toBe(1000);
  });

  it("still constructs OpenAI Responses API requests for gpt-* models", async () => {
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

  it("routes text tasks through the Claude model baseline", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "routed text" }] })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "router",
        ANTHROPIC_API_KEY: "sk-ant-test"
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
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 64000,
          system: "Answer with evidence",
          messages: [{ role: "user", content: "question" }]
        })
      })
    );
    expect(result).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
      modelTier: "escalation_text",
      escalationReason: "risk_level_high",
      text: "routed text"
    });
  });

  it("routes visual-understanding tasks through Claude escalation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "visual analysis" }] })
    });
    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "router",
        ANTHROPIC_API_KEY: "sk-ant-test"
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
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 64000,
          system: "Read image",
          messages: [{ role: "user", content: "image payload" }]
        })
      })
    );
    expect(result).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
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

  it("extracts text from Anthropic content blocks", () => {
    expect(
      extractAnthropicText({
        content: [{ type: "text", text: "claude text" }]
      })
    ).toBe("claude text");
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
  it("passes AbortSignal to Anthropic messages fetch", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { content: [{ type: "text", text: "결과" }] };
        }
      };
    });

    const provider = createModelProvider(
      {
        FINPROOF_MODEL_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "test-key",
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
