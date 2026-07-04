import type { RiskLevel } from "@/domain/types";

type Env = Record<string, string | undefined>;

export type ModelRouteTask =
  | "file_classification"
  | "product_type_classification"
  | "required_material_check"
  | "parser_normalization"
  | "ocr_visual_understanding"
  | "main_compliance"
  | "creative_review"
  | "product_terms"
  | "regulation_agent"
  | "internal_policy_agent"
  | "social_context_risk"
  | "case_search"
  | "english_translator_risk"
  | "vietnamese_translator_risk"
  | "myanmar_translator_risk"
  | "khmer_translator_risk"
  | "korean_compliance_mapping"
  | "retrieval_query"
  | "evidence_verification"
  | "cove_evidence_answering"
  | "absolute_claim_judgment"
  | "rag_chat"
  | "opinion_draft"
  | "draft_quality_review"
  | "report_generation"
  | "regulation_update_monitor"
  | "embedding";

export type ModelTier =
  | "default_text"
  | "escalation_text"
  | "highest_precision_text"
  | "embedding"
  | "embedding_escalation";

export type ModelRouteContext = {
  riskLevel?: RiskLevel;
  ambiguousClassification?: boolean;
  reviewPossibleGating?: boolean;
  lowOcrConfidence?: boolean;
  complexCondition?: boolean;
  complexVisual?: boolean;
  visualUnderstanding?: boolean;
  agentConflict?: boolean;
  internalPolicyConflict?: boolean;
  productCaseConflict?: boolean;
  legalInterpretation?: boolean;
  evidenceContradiction?: boolean;
  evidenceCount?: number;
  evidenceRelevanceScore?: number;
  caseStronglyInfluencesJudgment?: boolean;
  repeatedSearchFailure?: boolean;
  finalRejectionWording?: boolean;
  includesLegalOrPolicyText?: boolean;
  reviewerEscalationRequested?: boolean;
  sensitiveOutput?: boolean;
  regulatoryImpact?: boolean;
  highRecallRequired?: boolean;
};

export type ModelRoutingConfig = {
  defaultTextModel: string;
  escalationTextModel: string;
  highestPrecisionTextModel: string;
  embeddingModel: string;
  embeddingEscalationModel: string;
  /**
   * Optional per-agent pin for the internal_policy agent. When set (to an
   * `HCX-*` HyperCLOVA X model), internal_policy is served by this model
   * regardless of tier; unset restores the default Claude tier behavior, so
   * rollback is a pure env change.
   */
  internalPolicyModel?: string;
};

export type ModelRoute = {
  task: ModelRouteTask;
  provider: "anthropic" | "openai" | "gemini" | "hyperclova";
  model: string;
  modelTier: ModelTier;
  escalationReason?: string;
};

/**
 * Infers the serving provider from the configured model name so that switching
 * providers is a pure env change (e.g. reverting a Claude ID back to a `gpt-*`
 * name automatically routes to OpenAI again). `claude-*` → Anthropic, `HCX-*`
 * → HyperCLOVA X (Naver CLOVA Studio), everything else → OpenAI.
 */
export function providerForModel(model: string): "anthropic" | "openai" | "hyperclova" {
  const trimmed = model.trim();

  if (/^claude[-\w.]*/i.test(trimmed)) {
    return "anthropic";
  }

  if (/^hcx[-\w.]*/i.test(trimmed)) {
    return "hyperclova";
  }

  return "openai";
}

function value(env: Env, key: string): string | undefined {
  const raw = env[key];

  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function nonGeminiModel(env: Env, key: string, fallback: string): string {
  const configuredModel = value(env, key);

  return configuredModel && !/^gemini[-\w.]*/i.test(configuredModel) ? configuredModel : fallback;
}

export function getModelRoutingConfig(env: Env = process.env): ModelRoutingConfig {
  return {
    defaultTextModel: nonGeminiModel(env, "FINPROOF_MODEL_DEFAULT_TEXT", "claude-sonnet-5"),
    escalationTextModel: nonGeminiModel(env, "FINPROOF_MODEL_ESCALATION_TEXT", "claude-sonnet-5"),
    highestPrecisionTextModel: nonGeminiModel(
      env,
      "FINPROOF_MODEL_HIGHEST_PRECISION_TEXT",
      "claude-opus-4-8"
    ),
    embeddingModel: nonGeminiModel(env, "FINPROOF_EMBEDDING_MODEL", "text-embedding-3-small"),
    embeddingEscalationModel: nonGeminiModel(
      env,
      "FINPROOF_EMBEDDING_ESCALATION_MODEL",
      "text-embedding-3-large"
    ),
    internalPolicyModel: value(env, "FINPROOF_MODEL_INTERNAL_POLICY")
  };
}

function isHighRisk(context: ModelRouteContext) {
  return context.riskLevel === "high";
}

function lowEvidence(context: ModelRouteContext) {
  return (
    context.evidenceContradiction ||
    context.evidenceCount === 1 ||
    (typeof context.evidenceRelevanceScore === "number" && context.evidenceRelevanceScore < 0.72)
  );
}

function escalationReason(context: ModelRouteContext): string | undefined {
  if (context.reviewerEscalationRequested) {
    return "reviewer_requested";
  }

  if (isHighRisk(context)) {
    return "risk_level_high";
  }

  if (context.agentConflict) {
    return "agent_conflict";
  }

  if (context.internalPolicyConflict) {
    return "internal_policy_conflict";
  }

  if (context.productCaseConflict) {
    return "product_case_conflict";
  }

  if (context.legalInterpretation) {
    return "legal_interpretation";
  }

  if (context.evidenceContradiction) {
    return "evidence_contradiction";
  }

  if (lowEvidence(context)) {
    return "low_evidence";
  }

  if (context.finalRejectionWording) {
    return "final_rejection_wording";
  }

  if (context.includesLegalOrPolicyText) {
    return "legal_or_policy_text";
  }

  return undefined;
}

function textRoute(
  task: ModelRouteTask,
  tier: Extract<ModelTier, "default_text" | "escalation_text" | "highest_precision_text">,
  config: ModelRoutingConfig,
  reason?: string
): ModelRoute {
  const modelByTier = {
    default_text: config.defaultTextModel,
    escalation_text: config.escalationTextModel,
    highest_precision_text: config.highestPrecisionTextModel
  };

  const model = modelByTier[tier];

  return {
    task,
    provider: providerForModel(model),
    model,
    modelTier: tier,
    ...(reason ? { escalationReason: reason } : {})
  };
}

export function selectModelRoute(
  task: ModelRouteTask,
  context: ModelRouteContext = {},
  config = getModelRoutingConfig()
): ModelRoute {
  if (task === "embedding") {
    return {
      task,
      provider: "openai",
      model: context.highRecallRequired ? config.embeddingEscalationModel : config.embeddingModel,
      modelTier: context.highRecallRequired ? "embedding_escalation" : "embedding",
      ...(context.highRecallRequired ? { escalationReason: "high_recall_required" } : {})
    };
  }

  // internal_policy is pinned to a dedicated model (HyperCLOVA X HCX-007) when
  // FINPROOF_MODEL_INTERNAL_POLICY is set. The model is fixed across tiers per
  // the migration decision; escalationReason is still surfaced for observability.
  // Unset env falls through to the shared Claude text tiers below (rollback).
  if (task === "internal_policy_agent" && config.internalPolicyModel) {
    const reason = escalationReason(context);

    return {
      task,
      provider: providerForModel(config.internalPolicyModel),
      model: config.internalPolicyModel,
      modelTier: reason ? "escalation_text" : "default_text",
      ...(reason ? { escalationReason: reason } : {})
    };
  }

  if (task === "ocr_visual_understanding") {
    const reason = context.complexVisual
      ? "complex_visual"
      : context.lowOcrConfidence
        ? "low_ocr_confidence"
        : undefined;

    return textRoute(task, reason ? "escalation_text" : "default_text", config, reason);
  }

  if (task === "creative_review" && (context.visualUnderstanding || context.complexVisual)) {
    const reason = context.complexVisual ? "complex_visual" : undefined;
    return textRoute(task, reason ? "escalation_text" : "default_text", config, reason);
  }

  if (
    task === "english_translator_risk" ||
    task === "vietnamese_translator_risk" ||
    task === "myanmar_translator_risk" ||
    task === "khmer_translator_risk"
  ) {
    const reason = context.lowOcrConfidence ? "low_ocr_confidence" : escalationReason(context);
    return textRoute(task, reason ? "escalation_text" : "default_text", config, reason);
  }

  if (task === "main_compliance") {
    return context.sensitiveOutput
      ? textRoute(task, "highest_precision_text", config, "sensitive_output")
      : textRoute(task, "escalation_text", config, "lead_agent_final_judgment");
  }

  if (task === "korean_compliance_mapping") {
    return textRoute(task, "escalation_text", config, "korean_compliance_mapping");
  }

  if (task === "cove_evidence_answering") {
    return context.sensitiveOutput
      ? textRoute(task, "highest_precision_text", config, "sensitive_cove_verification")
      : textRoute(task, "escalation_text", config, escalationReason(context) ?? "cove_verification");
  }

  if (task === "draft_quality_review") {
    return context.sensitiveOutput
      ? textRoute(task, "highest_precision_text", config, "sensitive_output")
      : textRoute(task, "escalation_text", config);
  }

  const reason =
    context.ambiguousClassification && task === "product_type_classification"
      ? "ambiguous_classification"
      : context.reviewPossibleGating && task === "required_material_check"
        ? "review_possible_gating"
        : context.complexCondition && task === "parser_normalization"
          ? "complex_condition"
          : context.caseStronglyInfluencesJudgment && task === "case_search"
            ? "case_influences_judgment"
            : context.repeatedSearchFailure && task === "retrieval_query"
              ? "repeated_search_failure"
              : context.regulatoryImpact && task === "regulation_update_monitor"
                ? "regulatory_impact"
                : escalationReason(context);

  return textRoute(task, reason ? "escalation_text" : "default_text", config, reason);
}
