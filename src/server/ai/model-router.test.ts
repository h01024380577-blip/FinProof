import { getModelRoutingConfig, providerForModel, selectModelRoute } from "./model-router";

describe("model router", () => {
  it("uses Claude text defaults", () => {
    expect(getModelRoutingConfig({})).toEqual({
      defaultTextModel: "claude-sonnet-5",
      escalationTextModel: "claude-sonnet-5",
      highestPrecisionTextModel: "claude-opus-4-8",
      embeddingModel: "text-embedding-3-small",
      embeddingEscalationModel: "text-embedding-3-large"
    });
  });

  it("refuses Gemini model names in non-OCR routing config", () => {
    expect(
      getModelRoutingConfig({
        FINPROOF_MODEL_DEFAULT_TEXT: "gemini-2.5-flash",
        FINPROOF_MODEL_ESCALATION_TEXT: "gemini-2.5-pro"
      })
    ).toMatchObject({
      defaultTextModel: "claude-sonnet-5",
      escalationTextModel: "claude-sonnet-5"
    });
  });

  it("infers the provider from the configured model name", () => {
    expect(providerForModel("claude-sonnet-4-6")).toBe("anthropic");
    expect(providerForModel("claude-haiku-4-5")).toBe("anthropic");
    expect(providerForModel("claude-opus-4-8")).toBe("anthropic");
    expect(providerForModel("gpt-5-mini")).toBe("openai");
    expect(providerForModel("text-embedding-3-small")).toBe("openai");
  });

  it("routes normal RAG chat to the default Claude text model", () => {
    expect(selectModelRoute("rag_chat", {})).toEqual({
      task: "rag_chat",
      provider: "anthropic",
      model: "claude-sonnet-5",
      modelTier: "default_text"
    });
  });

  it("escalates high-risk RAG chat to the review model", () => {
    expect(selectModelRoute("rag_chat", { riskLevel: "high" })).toEqual({
      task: "rag_chat",
      provider: "anthropic",
      model: "claude-sonnet-5",
      modelTier: "escalation_text",
      escalationReason: "risk_level_high"
    });
  });

  it("routes the main compliance lead agent to an upper text model", () => {
    expect(selectModelRoute("main_compliance", {})).toEqual({
      task: "main_compliance",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      modelTier: "escalation_text",
      escalationReason: "lead_agent_final_judgment"
    });
    expect(selectModelRoute("main_compliance", { sensitiveOutput: true })).toEqual({
      task: "main_compliance",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      modelTier: "escalation_text",
      escalationReason: "sensitive_output"
    });
  });

  it("keeps visual-understanding review routes on Claude text models", () => {
    expect(selectModelRoute("ocr_visual_understanding", {})).toEqual({
      task: "ocr_visual_understanding",
      provider: "anthropic",
      model: "claude-sonnet-5",
      modelTier: "default_text"
    });
    expect(selectModelRoute("ocr_visual_understanding", { complexVisual: true })).toEqual({
      task: "ocr_visual_understanding",
      provider: "anthropic",
      model: "claude-sonnet-5",
      modelTier: "escalation_text",
      escalationReason: "complex_visual"
    });
  });

  it("reverting a text tier to a gpt-* name routes that tier back to OpenAI", () => {
    expect(
      selectModelRoute("rag_chat", {}, getModelRoutingConfig({ FINPROOF_MODEL_DEFAULT_TEXT: "gpt-5-mini" }))
    ).toEqual({
      task: "rag_chat",
      provider: "openai",
      model: "gpt-5-mini",
      modelTier: "default_text"
    });
  });

  it("routes embeddings to the configured OpenAI embedding models", () => {
    expect(selectModelRoute("embedding", {})).toMatchObject({
      provider: "openai",
      model: "text-embedding-3-small",
      modelTier: "embedding"
    });
    expect(selectModelRoute("embedding", { highRecallRequired: true })).toMatchObject({
      provider: "openai",
      model: "text-embedding-3-large",
      modelTier: "embedding_escalation",
      escalationReason: "high_recall_required"
    });
  });

  it("routes language translator risk agents to default text unless confidence is low", () => {
    for (const task of [
      "english_translator_risk",
      "vietnamese_translator_risk",
      "myanmar_translator_risk",
      "khmer_translator_risk"
    ] as const) {
      expect(selectModelRoute(task, {})).toEqual({
        task,
        provider: "anthropic",
        model: "claude-sonnet-5",
        modelTier: "default_text"
      });
    }

    expect(selectModelRoute("vietnamese_translator_risk", { lowOcrConfidence: true })).toEqual({
      task: "vietnamese_translator_risk",
      provider: "anthropic",
      model: "claude-sonnet-5",
      modelTier: "escalation_text",
      escalationReason: "low_ocr_confidence"
    });
  });

  it("routes Korean compliance mapping to escalation text by default", () => {
    expect(selectModelRoute("korean_compliance_mapping", {})).toEqual({
      task: "korean_compliance_mapping",
      provider: "anthropic",
      model: "claude-sonnet-5",
      modelTier: "escalation_text",
      escalationReason: "korean_compliance_mapping"
    });
  });

  it("routes fast domain agents through Haiku", () => {
    for (const task of ["creative_review", "product_terms", "social_context_risk"] as const) {
      expect(selectModelRoute(task, {})).toEqual({
        task,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        modelTier: "default_text"
      });
    }

    expect(selectModelRoute("social_context_risk", {})).toEqual({
      task: "social_context_risk",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      modelTier: "default_text"
    });
    expect(selectModelRoute("social_context_risk", { riskLevel: "high" })).toEqual({
      task: "social_context_risk",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      modelTier: "default_text",
      escalationReason: "risk_level_high"
    });
  });

  it("keeps regulation and internal policy agents on Sonnet 4-6", () => {
    for (const task of ["regulation_agent", "internal_policy_agent"] as const) {
      expect(selectModelRoute(task, {})).toEqual({
        task,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        modelTier: "default_text"
      });
    }

    expect(selectModelRoute("regulation_agent", { riskLevel: "high" })).toEqual({
      task: "regulation_agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      modelTier: "default_text",
      escalationReason: "risk_level_high"
    });
  });

  it("routes CoVe evidence answering through the fast Claude review model", () => {
    expect(selectModelRoute("cove_evidence_answering", {})).toEqual({
      task: "cove_evidence_answering",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      modelTier: "escalation_text",
      escalationReason: "cove_verification"
    });
    expect(selectModelRoute("cove_evidence_answering", { sensitiveOutput: true })).toEqual({
      task: "cove_evidence_answering",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      modelTier: "escalation_text",
      escalationReason: "sensitive_cove_verification"
    });
  });

  it("routes evidence verification through the fast Claude review model", () => {
    expect(selectModelRoute("evidence_verification", { riskLevel: "high" })).toEqual({
      task: "evidence_verification",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      modelTier: "escalation_text",
      escalationReason: "risk_level_high"
    });
  });
});
