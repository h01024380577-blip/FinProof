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
  | "case_search"
  | "retrieval_query"
  | "evidence_verification"
  | "conflict_resolution"
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
  | "multimodal"
  | "multimodal_escalation"
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
  multimodalModel: string;
  multimodalEscalationModel: string;
  embeddingModel: string;
  embeddingEscalationModel: string;
};

export type ModelRoute = {
  task: ModelRouteTask;
  provider: "openai" | "gemini";
  model: string;
  modelTier: ModelTier;
  escalationReason?: string;
};

function value(env: Env, key: string): string | undefined {
  const raw = env[key];

  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

export function getModelRoutingConfig(env: Env = process.env): ModelRoutingConfig {
  return {
    defaultTextModel: value(env, "FINPROOF_MODEL_DEFAULT_TEXT") ?? "gpt-5-mini",
    escalationTextModel: value(env, "FINPROOF_MODEL_ESCALATION_TEXT") ?? "gpt-5.4",
    highestPrecisionTextModel: value(env, "FINPROOF_MODEL_HIGHEST_PRECISION_TEXT") ?? "gpt-5.5",
    multimodalModel: value(env, "FINPROOF_MODEL_MULTIMODAL") ?? "gemini-2.5-flash",
    multimodalEscalationModel:
      value(env, "FINPROOF_MODEL_MULTIMODAL_ESCALATION") ?? "gemini-2.5-pro",
    embeddingModel: value(env, "FINPROOF_EMBEDDING_MODEL") ?? "text-embedding-3-small",
    embeddingEscalationModel:
      value(env, "FINPROOF_EMBEDDING_ESCALATION_MODEL") ?? "text-embedding-3-large"
  };
}

function isHighRisk(context: ModelRouteContext) {
  return context.riskLevel === "high" || context.riskLevel === "reject_recommended";
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
    return context.riskLevel === "reject_recommended"
      ? "risk_level_reject_recommended"
      : "risk_level_high";
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

  if (context.lowOcrConfidence) {
    return "low_ocr_confidence";
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

  return {
    task,
    provider: "openai",
    model: modelByTier[tier],
    modelTier: tier,
    ...(reason ? { escalationReason: reason } : {})
  };
}

function multimodalRoute(
  task: ModelRouteTask,
  config: ModelRoutingConfig,
  reason?: string
): ModelRoute {
  return {
    task,
    provider: "gemini",
    model: reason ? config.multimodalEscalationModel : config.multimodalModel,
    modelTier: reason ? "multimodal_escalation" : "multimodal",
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

  if (task === "ocr_visual_understanding") {
    const reason = context.complexVisual
      ? "complex_visual"
      : context.lowOcrConfidence
        ? "low_ocr_confidence"
        : undefined;

    return multimodalRoute(task, config, reason);
  }

  if (task === "creative_review" && (context.visualUnderstanding || context.complexVisual)) {
    return multimodalRoute(task, config, context.complexVisual ? "complex_visual" : undefined);
  }

  if (task === "conflict_resolution") {
    return context.sensitiveOutput
      ? textRoute(task, "highest_precision_text", config, "sensitive_output")
      : textRoute(task, "escalation_text", config);
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
