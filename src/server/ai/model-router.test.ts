import { getModelRoutingConfig, selectModelRoute } from "./model-router";

describe("model router", () => {
  it("uses Obsidian baseline defaults", () => {
    expect(getModelRoutingConfig({})).toEqual({
      defaultTextModel: "gpt-5-mini",
      escalationTextModel: "gpt-5.4",
      highestPrecisionTextModel: "gpt-5.5",
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
      defaultTextModel: "gpt-5-mini",
      escalationTextModel: "gpt-5.4"
    });
  });

  it("routes normal RAG chat to the default text model", () => {
    expect(selectModelRoute("rag_chat", {})).toEqual({
      task: "rag_chat",
      provider: "openai",
      model: "gpt-5-mini",
      modelTier: "default_text"
    });
  });

  it("escalates high-risk RAG chat to the review model", () => {
    expect(selectModelRoute("rag_chat", { riskLevel: "high" })).toEqual({
      task: "rag_chat",
      provider: "openai",
      model: "gpt-5.4",
      modelTier: "escalation_text",
      escalationReason: "risk_level_high"
    });
  });

  it("routes the main compliance lead agent to an upper text model", () => {
    expect(selectModelRoute("main_compliance", {})).toEqual({
      task: "main_compliance",
      provider: "openai",
      model: "gpt-5.4",
      modelTier: "escalation_text",
      escalationReason: "lead_agent_final_judgment"
    });
    expect(selectModelRoute("main_compliance", { sensitiveOutput: true })).toEqual({
      task: "main_compliance",
      provider: "openai",
      model: "gpt-5.5",
      modelTier: "highest_precision_text",
      escalationReason: "sensitive_output"
    });
  });

  it("keeps multimodal review routes on OpenAI text models", () => {
    expect(selectModelRoute("ocr_visual_understanding", {})).toEqual({
      task: "ocr_visual_understanding",
      provider: "openai",
      model: "gpt-5-mini",
      modelTier: "default_text"
    });
    expect(selectModelRoute("ocr_visual_understanding", { complexVisual: true })).toEqual({
      task: "ocr_visual_understanding",
      provider: "openai",
      model: "gpt-5.4",
      modelTier: "escalation_text",
      escalationReason: "complex_visual"
    });
  });

  it("routes embeddings to the configured embedding models", () => {
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
        provider: "openai",
        model: "gpt-5-mini",
        modelTier: "default_text"
      });
    }

    expect(selectModelRoute("vietnamese_translator_risk", { lowOcrConfidence: true })).toEqual({
      task: "vietnamese_translator_risk",
      provider: "openai",
      model: "gpt-5.4",
      modelTier: "escalation_text",
      escalationReason: "low_ocr_confidence"
    });
  });

  it("routes Korean compliance mapping to escalation text by default", () => {
    expect(selectModelRoute("korean_compliance_mapping", {})).toEqual({
      task: "korean_compliance_mapping",
      provider: "openai",
      model: "gpt-5.4",
      modelTier: "escalation_text",
      escalationReason: "korean_compliance_mapping"
    });
  });

  it("routes social context risk like a normal domain agent unless risk is high", () => {
    expect(selectModelRoute("social_context_risk", {})).toEqual({
      task: "social_context_risk",
      provider: "openai",
      model: "gpt-5-mini",
      modelTier: "default_text"
    });
    expect(selectModelRoute("social_context_risk", { riskLevel: "high" })).toEqual({
      task: "social_context_risk",
      provider: "openai",
      model: "gpt-5.4",
      modelTier: "escalation_text",
      escalationReason: "risk_level_high"
    });
  });
});
