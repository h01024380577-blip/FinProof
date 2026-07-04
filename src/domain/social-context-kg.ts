import type { ReviewIssue, RiskLevel } from "./types";

export type SocialContextCountry = {
  countryId: string;
  nameKo?: string;
  nameEn?: string;
  nameLocal?: string;
  languages?: string[];
};

export type SocialContextSensitiveEvent = {
  id: string;
  countryId: string;
  nameKo: string;
  nameEn?: string;
  nameLocal?: string;
  aliases?: string[];
  dates?: string[];
  dateWindowDays?: number;
  eventType?: string[];
  sensitivityLevel?: RiskLevel | "high" | "caution" | "info";
  contexts?: string[];
  stakeholderGroups?: string[];
  associatedTermIds?: string[];
  associatedSymbolIds?: string[];
  regions?: string[];
  reviewPolicy?: string;
  sourceRefs?: string[];
};

export type SocialContextSensitiveTerm = {
  id: string;
  countryId: string;
  labelKo: string;
  labelEn?: string;
  labelLocal?: string;
  aliases?: string[];
  termType?: string;
  riskDomain?: string[];
  sensitivityLevel?: RiskLevel | "high" | "caution" | "info";
  associatedEventIds?: string[];
  unsafeWhenUsedAsMetaphor?: boolean;
  unsafeContexts?: string[];
  safeContexts?: string[];
  sourceRefs?: string[];
};

export type SocialContextSensitiveSymbol = {
  id: string;
  countryId: string;
  labelKo: string;
  labelEn?: string;
  labelLocal?: string;
  aliases?: string[];
  symbolType?: string;
  sensitivityLevel?: RiskLevel | "high" | "caution" | "info";
  associatedEventIds?: string[];
  unsafeContexts?: string[];
  safeContexts?: string[];
  sourceRefs?: string[];
};

export type SocialContextFinancialPromoTerm = {
  id: string;
  labelKo: string;
  labelEn?: string;
  aliases?: string[];
  category?: string;
  productTypes?: string[];
  riskWhenPairedWithSensitiveMetaphor?: boolean;
};

export type SocialContextCampaignIntent = {
  id: string;
  labelKo: string;
  aliases?: string[];
  keywords?: string[];
  commercialityWeight?: number;
};

export type SocialContextKgEdge = {
  from: string;
  relation: string;
  to: string;
  weight?: number;
  countryId?: string;
  note?: string;
};

export type SocialContextRiskRule = {
  id: string;
  nameKo: string;
  countryIds: string[];
  conditions: Record<string, unknown>;
  riskLevel: RiskLevel;
  suggestedAction: ReviewIssue["suggestedAction"];
  rationaleTemplate: string;
  examples?: string[];
};

export type SocialContextSafeContext = {
  id: string;
  countryId?: string;
  text: string;
  expectedRisk?: RiskLevel;
  reason?: string;
  safeContext?: string[];
};

export type SocialContextPriorCase = {
  id: string;
  countryId?: string;
  title: string;
  triggerTerms?: string[];
  riskPatternIds?: string[];
  consequences?: string[];
  lesson?: string;
  recommendedAction?: ReviewIssue["suggestedAction"];
  sourceRefs?: string[];
};

export type SocialContextDerogatorySlang = {
  id: string;
  surfaceForms: string[];
  category: string;
  targetGroups?: string[];
  normalMeanings?: string[];
  highRiskWhen?: string[];
  safeContextHints?: string[];
  defaultRisk?: RiskLevel;
  defaultAction?: ReviewIssue["suggestedAction"];
};

export type SocialContextKgSeed = {
  countries: SocialContextCountry[];
  sensitiveEvents: SocialContextSensitiveEvent[];
  sensitiveEventTerms: SocialContextSensitiveTerm[];
  sensitiveSymbolsVisual: SocialContextSensitiveSymbol[];
  financialPromoTerms: SocialContextFinancialPromoTerm[];
  campaignIntents: SocialContextCampaignIntent[];
  socialKgEdges: SocialContextKgEdge[];
  socialRiskRules: SocialContextRiskRule[];
  safeContexts: SocialContextSafeContext[];
  priorControversyCases: SocialContextPriorCase[];
  derogatorySocialSlang: SocialContextDerogatorySlang[];
};

export type SocialContextTracePhase =
  | "country"
  | "date"
  | "term"
  | "symbol"
  | "financial"
  | "campaign"
  | "slang"
  | "safe_context"
  | "event"
  | "rule"
  | "stakeholder";

/**
 * Step in the social-context KG activation pipeline, emitted in the real order the
 * engine touches nodes. Consumed by the live viewer to zoom/highlight the exact
 * nodes/edges the sub-agent references. `nodeIds` are canonical KG ids that map 1:1
 * to `social-kg-edges.json` endpoints and to the graph exposed by the graph API.
 */
export type SocialContextTrace = {
  phase: SocialContextTracePhase;
  nodeIds: string[];
  edges?: Array<{ from: string; relation: string; to: string }>;
  countryIds?: string[];
  riskLevel?: RiskLevel;
  note?: string;
};

export type SocialContextDateMatch = {
  plannedDate: string;
  mmdd: string;
  event: SocialContextSensitiveEvent;
  date: string;
  distanceDays: number;
};

export type SocialContextRuleMatch = {
  id: string;
  countryId: string;
  rule: SocialContextRiskRule;
  riskLevel: RiskLevel;
  suggestedAction: ReviewIssue["suggestedAction"];
  targetText: string;
  rationale: string;
  matchedPath: string[];
  matchedDate?: SocialContextDateMatch;
  matchedEvents: SocialContextSensitiveEvent[];
  matchedTerms: SocialContextSensitiveTerm[];
  matchedSymbols: SocialContextSensitiveSymbol[];
  matchedFinancialTerms: SocialContextFinancialPromoTerm[];
  matchedCampaignIntents: SocialContextCampaignIntent[];
  matchedSafeContexts: SocialContextSafeContext[];
  matchedPriorCases: SocialContextPriorCase[];
  matchedDerogatorySlang: SocialContextDerogatorySlang[];
  confidence: number;
};
