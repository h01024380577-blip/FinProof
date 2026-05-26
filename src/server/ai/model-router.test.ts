import { getModelRoutingConfig, selectModelRoute } from "./model-router";

describe("model router", () => {
  it("uses Obsidian baseline defaults", () => {
    expect(getModelRoutingConfig({})).toEqual({
      defaultTextModel: "gpt-5-mini",
      escalationTextModel: "gpt-5.4",
      highestPrecisionTextModel: "gpt-5.5",
      multimodalModel: "gemini-2.5-flash",
      multimodalEscalationModel: "gemini-2.5-pro",
      embeddingModel: "text-embedding-3-small",
      embeddingEscalationModel: "text-embedding-3-large"
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

  it("uses the highest precision text model for sensitive conflict resolution", () => {
    expect(selectModelRoute("conflict_resolution", { sensitiveOutput: true })).toEqual({
      task: "conflict_resolution",
      provider: "openai",
      model: "gpt-5.5",
      modelTier: "highest_precision_text",
      escalationReason: "sensitive_output"
    });
  });

  it("routes multimodal review to Gemini and escalates complex visual review", () => {
    expect(selectModelRoute("ocr_visual_understanding", {})).toEqual({
      task: "ocr_visual_understanding",
      provider: "gemini",
      model: "gemini-2.5-flash",
      modelTier: "multimodal"
    });
    expect(selectModelRoute("ocr_visual_understanding", { complexVisual: true })).toEqual({
      task: "ocr_visual_understanding",
      provider: "gemini",
      model: "gemini-2.5-pro",
      modelTier: "multimodal_escalation",
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
});
