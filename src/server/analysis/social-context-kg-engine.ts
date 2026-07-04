import type { ReviewCase, RiskLevel } from "@/domain/types";
import type {
  SocialContextCountry,
  SocialContextCampaignIntent,
  SocialContextDateMatch,
  SocialContextDerogatorySlang,
  SocialContextFinancialPromoTerm,
  SocialContextKgSeed,
  SocialContextPriorCase,
  SocialContextRiskRule,
  SocialContextRuleMatch,
  SocialContextSafeContext,
  SocialContextSensitiveEvent,
  SocialContextSensitiveSymbol,
  SocialContextSensitiveTerm,
  SocialContextTrace
} from "@/domain/social-context-kg";
import type { AgentFinding } from "./review-subagents";
import type { ExtractedDocument, RagEvidenceCandidate } from "./review-analysis-pipeline";
import { loadSocialContextKgSeed } from "./social-context-kg-loader";

type SocialContextKgInput = {
  review: ReviewCase;
  extractedDocuments: ExtractedDocument[];
  seed?: SocialContextKgSeed;
  /**
   * Optional sink invoked per activation phase (country → date → term → symbol …)
   * in the exact order the engine touches nodes. Used by the live viewer to drive
   * real-time zoom/highlight. Never affects matching output.
   */
  onTrace?: (trace: SocialContextTrace) => void;
};

const STAKEHOLDER_RELATIONS = new Set(["affectsStakeholder", "targetsGroup"]);

type MatchContext = {
  review: ReviewCase;
  text: string;
  countryIds: string[];
  plannedMmdd?: string;
  dateMatches: SocialContextDateMatch[];
  terms: SocialContextSensitiveTerm[];
  symbols: SocialContextSensitiveSymbol[];
  events: SocialContextSensitiveEvent[];
  financialTerms: SocialContextFinancialPromoTerm[];
  campaignIntents: SocialContextCampaignIntent[];
  safeContexts: SocialContextSafeContext[];
  priorCases: SocialContextPriorCase[];
  derogatorySlang: SocialContextDerogatorySlang[];
};

const FINANCIAL_AD_INTENT = "financial_product_ad";
const COMMERCIAL_INTENT_THRESHOLD = 0.5;

function normalizeText(value: string | undefined): string {
  return (value ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeForId(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

function compact(value: string, maxLength = 900): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function includesAlias(text: string, alias: string | undefined): boolean {
  const normalizedAlias = normalizeText(alias);

  if (!normalizedAlias || normalizedAlias.length < 2) {
    return false;
  }

  return text.includes(normalizedAlias);
}

function matchesAnyAlias(text: string, values: Array<string | undefined> | undefined): boolean {
  return (values ?? []).some((value) => includesAlias(text, value));
}

function reviewText(review: ReviewCase, extractedDocuments: ExtractedDocument[]): string {
  return normalizeText(
    [
      review.title,
      review.promotionalCopy,
      review.productDescription,
      review.disclosure,
      review.productType,
      review.channelType.join(" "),
      ...extractedDocuments.map((document) => document.text)
    ].join(" ")
  );
}

function mmddFromDate(value: string | undefined): string | undefined {
  const isoMatch = value?.match(/^\d{4}-(\d{2})-(\d{2})/);

  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}`;
  }

  const compactMatch = value?.match(/^(\d{2})(\d{2})$/);

  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}`;
  }

  return undefined;
}

function parseMmdd(value: string | undefined): { month: number; day: number } | undefined {
  const match = value?.match(/^(\d{2})-(\d{2})$/);

  if (!match) {
    return undefined;
  }

  return { month: Number(match[1]), day: Number(match[2]) };
}

function dayOfYear(mmdd: string): number | undefined {
  const parsed = parseMmdd(mmdd);

  if (!parsed) {
    return undefined;
  }

  const date = Date.UTC(2024, parsed.month - 1, parsed.day);
  const start = Date.UTC(2024, 0, 1);

  return Math.floor((date - start) / 86_400_000) + 1;
}

function distanceDays(left: string, right: string): number | undefined {
  const leftDay = dayOfYear(left);
  const rightDay = dayOfYear(right);

  if (leftDay === undefined || rightDay === undefined) {
    return undefined;
  }

  const direct = Math.abs(leftDay - rightDay);

  return Math.min(direct, 366 - direct);
}

function dateMatchesFor(
  plannedDate: string,
  plannedMmdd: string | undefined,
  events: SocialContextSensitiveEvent[]
): SocialContextDateMatch[] {
  if (!plannedMmdd) {
    return [];
  }

  return events.flatMap((event) =>
    (event.dates ?? []).flatMap((eventDate) => {
      const distance = distanceDays(plannedMmdd, eventDate);
      const windowDays = event.dateWindowDays ?? 0;

      return distance !== undefined && distance <= windowDays
        ? [
            {
              plannedDate,
              mmdd: plannedMmdd,
              event,
              date: eventDate,
              distanceDays: distance
            }
          ]
        : [];
    })
  );
}

function matchedTerms(text: string, terms: SocialContextSensitiveTerm[]) {
  return terms.filter((term) =>
    matchesAnyAlias(text, [term.labelKo, term.labelEn, ...(term.aliases ?? [])])
  );
}

function matchedSymbols(text: string, symbols: SocialContextSensitiveSymbol[]) {
  return symbols.filter((symbol) =>
    matchesAnyAlias(text, [symbol.labelKo, symbol.labelEn, ...(symbol.aliases ?? [])])
  );
}

function matchedFinancialTerms(text: string, terms: SocialContextFinancialPromoTerm[]) {
  return terms.filter((term) =>
    matchesAnyAlias(text, [term.labelKo, term.labelEn, ...(term.aliases ?? [])])
  );
}

function matchedCampaignIntents(text: string, intents: SocialContextCampaignIntent[]) {
  return intents.filter((intent) =>
    matchesAnyAlias(text, [intent.labelKo, ...(intent.aliases ?? []), ...(intent.keywords ?? [])])
  );
}

function matchedSafeContexts(
  text: string,
  safeContexts: SocialContextSafeContext[],
  terms: SocialContextSensitiveTerm[],
  slang: SocialContextDerogatorySlang[]
) {
  const matchedBySafeContext = safeContexts.filter((context) => includesAlias(text, context.text));
  const matchedByTermHints = terms.flatMap((term) =>
    (term.safeContexts ?? [])
      .filter((safeContext) => includesAlias(text, safeContext))
      .map<SocialContextSafeContext>((safeContext) => ({
        id: `term-safe-${term.id}-${normalizeForId(safeContext)}`,
        countryId: term.countryId,
        text: safeContext,
        expectedRisk: "info",
        reason: `${term.labelKo} 안전 문맥`,
        safeContext: [safeContext]
      }))
  );
  const matchedBySlangHints = slang.flatMap((item) =>
    (item.safeContextHints ?? [])
      .filter((hint) => includesAlias(text, hint))
      .map<SocialContextSafeContext>((hint) => ({
        id: `slang-safe-${item.id}-${normalizeForId(hint)}`,
        countryId: "south_korea",
        text: hint,
        expectedRisk: "info",
        reason: `${item.id} 안전 문맥`,
        safeContext: [hint]
      }))
  );

  return uniqueById([...matchedBySafeContext, ...matchedByTermHints, ...matchedBySlangHints]);
}

function matchedDerogatorySlang(text: string, slang: SocialContextDerogatorySlang[]) {
  return slang.filter((item) => matchesAnyAlias(text, item.surfaceForms));
}

function eventIdsFromTermsAndSymbols(
  terms: SocialContextSensitiveTerm[],
  symbols: SocialContextSensitiveSymbol[]
) {
  return new Set([
    ...terms.flatMap((term) => term.associatedEventIds ?? []),
    ...symbols.flatMap((symbol) => symbol.associatedEventIds ?? [])
  ]);
}

function matchedEvents(
  text: string,
  events: SocialContextSensitiveEvent[],
  dateMatches: SocialContextDateMatch[],
  terms: SocialContextSensitiveTerm[],
  symbols: SocialContextSensitiveSymbol[]
) {
  const associatedEventIds = eventIdsFromTermsAndSymbols(terms, symbols);

  return uniqueById([
    ...dateMatches.map((match) => match.event),
    ...events.filter((event) =>
      matchesAnyAlias(text, [event.nameKo, event.nameEn, ...(event.aliases ?? [])])
    ),
    ...events.filter((event) => associatedEventIds.has(event.id))
  ]);
}

function countryScoped<T extends { countryId?: string }>(items: T[], countryIds: string[]) {
  return items.filter((item) => !item.countryId || countryIds.includes(item.countryId));
}

function countryScopedDateMatches(
  items: SocialContextDateMatch[],
  countryIds: string[]
): SocialContextDateMatch[] {
  return items.filter((item) => countryIds.includes(item.event.countryId));
}

function inferTargetCountryIds(text: string, countries: SocialContextCountry[]): string[] {
  const countryIds = new Set<string>(["south_korea"]);

  for (const country of countries) {
    if (
      [country.nameKo, country.nameEn, country.nameLocal].some((name) => includesAlias(text, name))
    ) {
      countryIds.add(country.countryId);
    }
  }

  if (/[\u1780-\u17ff]/.test(text)) {
    countryIds.add("cambodia");
  }

  if (/[\u1000-\u109f]/.test(text)) {
    countryIds.add("myanmar");
  }

  if (/[\u0e00-\u0e7f]/.test(text)) {
    countryIds.add("thailand");
  }

  if (/[\u4e00-\u9fff]/.test(text)) {
    countryIds.add("china");
  }

  if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text)) {
    countryIds.add("vietnam");
  }

  return [...countryIds];
}

function valueList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function valueBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function hasTermType(terms: SocialContextSensitiveTerm[], types: string[]) {
  return terms.some((term) => term.termType && types.includes(term.termType));
}

function hasSymbolType(symbols: SocialContextSensitiveSymbol[], types: string[]) {
  return symbols.some((symbol) => symbol.symbolType && types.includes(symbol.symbolType));
}

function hasEventType(events: SocialContextSensitiveEvent[], types: string[]) {
  return events.some((event) =>
    (event.eventType ?? []).some((eventType) => types.includes(eventType))
  );
}

function hasCampaignIntent(intents: SocialContextCampaignIntent[], ids: string[]) {
  return intents.some((intent) => ids.includes(intent.id));
}

function hasCommercialBenefit(context: MatchContext, intents: SocialContextCampaignIntent[]) {
  return (
    context.financialTerms.length > 0 ||
    intents.some((intent) => (intent.commercialityWeight ?? 0) > COMMERCIAL_INTENT_THRESHOLD)
  );
}

function hasSafeContext(context: MatchContext) {
  return context.safeContexts.length > 0;
}

function conditionMatches(rule: SocialContextRiskRule, context: MatchContext): boolean {
  const countryIds = rule.countryIds;
  const conditions = rule.conditions;
  const ruleCountryIsInScope = countryIds.some((countryId) =>
    context.countryIds.includes(countryId)
  );
  const dateMatches = countryScopedDateMatches(context.dateMatches, countryIds);
  const terms = countryScoped(context.terms, countryIds);
  const symbols = countryScoped(context.symbols, countryIds);
  const events = countryScoped(context.events, countryIds);
  const safeContexts = countryScoped(context.safeContexts, countryIds);
  const slang = context.derogatorySlang;
  const campaignIntents = context.campaignIntents;
  const financialTerms = context.financialTerms;

  if (!ruleCountryIsInScope) {
    return false;
  }

  const ruleChecksSafeContext = [
    "safeContextAnyOf",
    "safeContextMatched",
    "safeCulturalContext",
    "safeOfficialRespectContext"
  ].some((key) => key in conditions);

  if (safeContexts.length > 0 && rule.riskLevel !== "info" && !ruleChecksSafeContext) {
    return false;
  }

  const checks: boolean[] = [];

  if ("dateMatchesSensitiveEvent" in conditions) {
    checks.push(
      valueBool(conditions.dateMatchesSensitiveEvent)
        ? dateMatches.length > 0
        : dateMatches.length === 0
    );
  }

  if ("containsSensitiveTermTypeAny" in conditions) {
    checks.push(hasTermType(terms, valueList(conditions.containsSensitiveTermTypeAny)));
  }

  if ("containsTermTypeAny" in conditions) {
    checks.push(hasTermType(terms, valueList(conditions.containsTermTypeAny)));
  }

  if ("containsTermTypeAnyOf" in conditions) {
    checks.push(hasTermType(terms, valueList(conditions.containsTermTypeAnyOf)));
  }

  if ("containsVisualOrTextTermType" in conditions) {
    const type =
      typeof conditions.containsVisualOrTextTermType === "string"
        ? conditions.containsVisualOrTextTermType
        : "";
    checks.push(hasTermType(terms, [type]) || hasSymbolType(symbols, [type]));
  }

  if ("containsEventMechanismTerm" in conditions) {
    checks.push(
      valueBool(conditions.containsEventMechanismTerm)
        ? terms.some((term) => term.termType === "event_mechanism")
        : !terms.some((term) => term.termType === "event_mechanism")
    );
  }

  if ("containsFinancialPromoTerm" in conditions) {
    checks.push(
      valueBool(conditions.containsFinancialPromoTerm)
        ? financialTerms.length > 0
        : financialTerms.length === 0
    );
  }

  if ("containsFinancialProductBenefit" in conditions) {
    checks.push(
      valueBool(conditions.containsFinancialProductBenefit)
        ? financialTerms.length > 0
        : financialTerms.length === 0
    );
  }

  if ("containsCampaignIntentAnyOf" in conditions) {
    checks.push(
      hasCampaignIntent(campaignIntents, valueList(conditions.containsCampaignIntentAnyOf))
    );
  }

  if ("campaignIntentAnyOf" in conditions) {
    checks.push(hasCampaignIntent(campaignIntents, valueList(conditions.campaignIntentAnyOf)));
  }

  if ("containsSymbolTypeAny" in conditions) {
    checks.push(hasSymbolType(symbols, valueList(conditions.containsSymbolTypeAny)));
  }

  if ("eventTypeAny" in conditions) {
    checks.push(hasEventType(events, valueList(conditions.eventTypeAny)));
  }

  if ("eventTypeAnyOf" in conditions) {
    checks.push(hasEventType(events, valueList(conditions.eventTypeAnyOf)));
  }

  if ("containsSensitiveEvent" in conditions) {
    checks.push(
      valueBool(conditions.containsSensitiveEvent) ? events.length > 0 : events.length === 0
    );
  }

  if ("containsCommercialBenefit" in conditions) {
    const commercial = hasCommercialBenefit(context, campaignIntents);
    checks.push(valueBool(conditions.containsCommercialBenefit) ? commercial : !commercial);
  }

  if ("containsTerm" in conditions) {
    checks.push(
      typeof conditions.containsTerm === "string" &&
        includesAlias(context.text, conditions.containsTerm)
    );
  }

  if ("safeContextAnyOf" in conditions) {
    const safeContextIds = valueList(conditions.safeContextAnyOf);
    checks.push(
      safeContexts.some((context) =>
        [context.id, context.text, ...(context.safeContext ?? [])].some((value) =>
          safeContextIds.some((safeContextId) =>
            normalizeText(value).includes(normalizeText(safeContextId))
          )
        )
      )
    );
  }

  if ("safeContextMatched" in conditions) {
    checks.push(
      valueBool(conditions.safeContextMatched) ? hasSafeContext(context) : !hasSafeContext(context)
    );
  }

  if ("safeCulturalContext" in conditions) {
    checks.push(
      valueBool(conditions.safeCulturalContext) ? hasSafeContext(context) : !hasSafeContext(context)
    );
  }

  if ("safeOfficialRespectContext" in conditions) {
    checks.push(
      valueBool(conditions.safeOfficialRespectContext)
        ? hasSafeContext(context)
        : !hasSafeContext(context)
    );
  }

  if ("containsNoSacredMockery" in conditions) {
    checks.push(true);
  }

  if ("marketingMaterialHasMapOrFlag" in conditions) {
    const hasMapOrFlag = /지도|국기|flag|map/i.test(context.text);
    checks.push(valueBool(conditions.marketingMaterialHasMapOrFlag) ? hasMapOrFlag : !hasMapOrFlag);
  }

  if ("symbolDistortedOrUsedAsPriceTag" in conditions) {
    const distorted = /가격표|쿠폰|할인|price|coupon|discount/i.test(context.text);
    checks.push(valueBool(conditions.symbolDistortedOrUsedAsPriceTag) ? distorted : !distorted);
  }

  if ("containsDerogatorySlangCategory" in conditions) {
    checks.push(
      typeof conditions.containsDerogatorySlangCategory === "string" &&
        slang.some((item) => item.category === conditions.containsDerogatorySlangCategory)
    );
  }

  if ("containsDerogatorySlangCategoryAnyOf" in conditions) {
    const categories = valueList(conditions.containsDerogatorySlangCategoryAnyOf);
    checks.push(slang.some((item) => categories.includes(item.category)));
  }

  if ("containsAmbiguousSensitiveTerm" in conditions) {
    checks.push(
      valueBool(conditions.containsAmbiguousSensitiveTerm)
        ? terms.length > 0 || slang.length > 0
        : terms.length === 0 && slang.length === 0
    );
  }

  return checks.length > 0 && checks.every(Boolean);
}

function priorityForRisk(riskLevel: RiskLevel) {
  return riskLevel === "high" ? 3 : riskLevel === "caution" ? 2 : 1;
}

function riskConfidence(riskLevel: RiskLevel) {
  return riskLevel === "high" ? 0.93 : riskLevel === "caution" ? 0.84 : 0.74;
}

function firstDateMatchForRule(rule: SocialContextRiskRule, context: MatchContext) {
  return countryScopedDateMatches(context.dateMatches, rule.countryIds)[0];
}

function ruleCountryId(rule: SocialContextRiskRule, context: MatchContext) {
  return (
    firstDateMatchForRule(rule, context)?.event.countryId ??
    countryScoped(context.events, rule.countryIds)[0]?.countryId ??
    countryScoped(context.terms, rule.countryIds)[0]?.countryId ??
    countryScoped(context.symbols, rule.countryIds)[0]?.countryId ??
    rule.countryIds[0] ??
    "global"
  );
}

function primaryEvent(rule: SocialContextRiskRule, context: MatchContext) {
  const dateMatch = firstDateMatchForRule(rule, context);

  return dateMatch?.event ?? countryScoped(context.events, rule.countryIds)[0];
}

function targetTextFor(rule: SocialContextRiskRule, context: MatchContext) {
  const dateMatch = firstDateMatchForRule(rule, context);
  const term = countryScoped(context.terms, rule.countryIds)[0];
  const symbol = countryScoped(context.symbols, rule.countryIds)[0];
  const financial = context.financialTerms[0];
  const slang = context.derogatorySlang[0];

  return [
    dateMatch?.plannedDate,
    term?.labelKo,
    symbol?.labelKo,
    slang?.surfaceForms[0],
    financial?.labelKo
  ]
    .filter(Boolean)
    .join(" / ");
}

function matchedPathFor(rule: SocialContextRiskRule, context: MatchContext) {
  const dateMatch = firstDateMatchForRule(rule, context);
  const event = primaryEvent(rule, context);
  const terms = countryScoped(context.terms, rule.countryIds).slice(0, 3);
  const symbols = countryScoped(context.symbols, rule.countryIds).slice(0, 2);
  const financial = context.financialTerms.slice(0, 2);
  const intents = context.campaignIntents.slice(0, 2);

  return [
    dateMatch ? `게시 예정일 ${dateMatch.plannedDate} → 민감 날짜 ${dateMatch.date}` : undefined,
    event ? `${event.nameKo} (${event.eventType?.join(", ") ?? "민감 사건"})` : undefined,
    ...terms.map((term) => `${term.labelKo} → ${term.termType ?? "민감 표현"}`),
    ...symbols.map((symbol) => `${symbol.labelKo} → ${symbol.symbolType ?? "민감 상징"}`),
    ...financial.map((term) => `${term.labelKo} → 금융 홍보 표현`),
    ...intents.map((intent) => `${intent.labelKo} → 캠페인 의도`),
    `탐지 규칙 ${rule.id}`
  ].filter((item): item is string => Boolean(item));
}

function priorCasesForRule(rule: SocialContextRiskRule, context: MatchContext) {
  const text = context.text;

  return context.priorCases.filter(
    (priorCase) =>
      priorCase.riskPatternIds?.includes(rule.id) ||
      (priorCase.triggerTerms ?? []).some((term) => includesAlias(text, term))
  );
}

function ruleMatch(rule: SocialContextRiskRule, context: MatchContext): SocialContextRuleMatch {
  const matchedDate = firstDateMatchForRule(rule, context);
  const matchedEvents = countryScoped(context.events, rule.countryIds);
  const matchedTermsForRule = countryScoped(context.terms, rule.countryIds);
  const matchedSymbolsForRule = countryScoped(context.symbols, rule.countryIds);
  const matchedSafeContextsForRule = countryScoped(context.safeContexts, rule.countryIds);
  const priorCases = priorCasesForRule(rule, context);
  const event = primaryEvent(rule, context);
  const term = matchedTermsForRule[0] ?? matchedSymbolsForRule[0];
  const targetText = targetTextFor(rule, context) || event?.nameKo || rule.nameKo;

  return {
    id: `${rule.id}-${normalizeForId(targetText)}`,
    countryId: ruleCountryId(rule, context),
    rule,
    riskLevel: rule.riskLevel,
    suggestedAction: rule.suggestedAction,
    targetText,
    rationale: rule.rationaleTemplate,
    matchedPath: matchedPathFor(rule, context),
    matchedDate,
    matchedEvents,
    matchedTerms: matchedTermsForRule,
    matchedSymbols: matchedSymbolsForRule,
    matchedFinancialTerms: context.financialTerms,
    matchedCampaignIntents: context.campaignIntents,
    matchedSafeContexts: matchedSafeContextsForRule,
    matchedPriorCases: priorCases,
    matchedDerogatorySlang: context.derogatorySlang,
    confidence: Math.max(riskConfidence(rule.riskLevel), term ? 0.82 : 0.74)
  };
}

function campaignIntentsWithInferredFinancialAd(
  intents: SocialContextCampaignIntent[],
  financialTerms: SocialContextFinancialPromoTerm[],
  seed: SocialContextKgSeed
) {
  if (financialTerms.length === 0 || intents.some((intent) => intent.id === FINANCIAL_AD_INTENT)) {
    return intents;
  }

  const financialIntent = seed.campaignIntents.find((intent) => intent.id === FINANCIAL_AD_INTENT);

  return financialIntent ? [...intents, financialIntent] : intents;
}

function matchContext(input: SocialContextKgInput): MatchContext {
  const seed = input.seed ?? loadSocialContextKgSeed();
  const emitTrace = (trace: SocialContextTrace) => {
    if (trace.nodeIds.length > 0 || (trace.edges?.length ?? 0) > 0) {
      input.onTrace?.(trace);
    }
  };
  const text = reviewText(input.review, input.extractedDocuments);
  const countryIds = inferTargetCountryIds(text, seed.countries);
  emitTrace({ phase: "country", nodeIds: countryIds, countryIds });
  const plannedMmdd = mmddFromDate(input.review.plannedPublishDate);
  const sensitiveEvents = countryScoped(seed.sensitiveEvents, countryIds);
  const sensitiveEventTerms = countryScoped(seed.sensitiveEventTerms, countryIds);
  const sensitiveSymbolsVisual = countryScoped(seed.sensitiveSymbolsVisual, countryIds);
  const safeContextSeeds = countryScoped(seed.safeContexts, countryIds);
  const derogatorySlangSeeds = countryIds.includes("south_korea") ? seed.derogatorySocialSlang : [];
  const dateMatches = dateMatchesFor(input.review.plannedPublishDate, plannedMmdd, sensitiveEvents);
  emitTrace({
    phase: "date",
    nodeIds: dateMatches.map((match) => `date-${match.date}`),
    edges: dateMatches.map((match) => ({
      from: match.event.id,
      relation: "hasSensitiveDate",
      to: `date-${match.date}`
    }))
  });
  const terms = matchedTerms(text, sensitiveEventTerms);
  emitTrace({ phase: "term", nodeIds: terms.map((term) => term.id) });
  const symbols = matchedSymbols(text, sensitiveSymbolsVisual);
  emitTrace({ phase: "symbol", nodeIds: symbols.map((symbol) => symbol.id) });
  const financialTerms = matchedFinancialTerms(text, seed.financialPromoTerms);
  emitTrace({ phase: "financial", nodeIds: financialTerms.map((term) => term.id) });
  const campaignIntents = campaignIntentsWithInferredFinancialAd(
    matchedCampaignIntents(text, seed.campaignIntents),
    financialTerms,
    seed
  );
  emitTrace({ phase: "campaign", nodeIds: campaignIntents.map((intent) => intent.id) });
  const derogatorySlang = matchedDerogatorySlang(text, derogatorySlangSeeds);
  emitTrace({ phase: "slang", nodeIds: derogatorySlang.map((slang) => slang.id) });
  const safeContexts = matchedSafeContexts(text, safeContextSeeds, terms, derogatorySlang);
  emitTrace({ phase: "safe_context", nodeIds: safeContexts.map((safeContext) => safeContext.id) });
  const events = matchedEvents(text, sensitiveEvents, dateMatches, terms, symbols);
  emitTrace({ phase: "event", nodeIds: events.map((event) => event.id) });
  const eventIds = new Set(events.map((event) => event.id));
  const stakeholderEdges = seed.socialKgEdges.filter(
    (edge) => STAKEHOLDER_RELATIONS.has(edge.relation) && eventIds.has(edge.from)
  );
  emitTrace({
    phase: "stakeholder",
    nodeIds: [...new Set(stakeholderEdges.map((edge) => edge.to))],
    edges: stakeholderEdges.map((edge) => ({
      from: edge.from,
      relation: edge.relation,
      to: edge.to
    }))
  });

  return {
    review: input.review,
    text,
    countryIds,
    plannedMmdd,
    dateMatches,
    terms,
    symbols,
    events,
    financialTerms,
    campaignIntents,
    safeContexts,
    priorCases: seed.priorControversyCases,
    derogatorySlang
  };
}

function dedupeRuleMatches(matches: SocialContextRuleMatch[]) {
  const bestByRule = new Map<string, SocialContextRuleMatch>();

  for (const match of matches) {
    const previous = bestByRule.get(match.rule.id);

    if (
      !previous ||
      priorityForRisk(match.riskLevel) > priorityForRisk(previous.riskLevel) ||
      match.confidence > previous.confidence
    ) {
      bestByRule.set(match.rule.id, match);
    }
  }

  return [...bestByRule.values()].sort((left, right) => {
    const riskDelta = priorityForRisk(right.riskLevel) - priorityForRisk(left.riskLevel);

    return riskDelta !== 0 ? riskDelta : right.confidence - left.confidence;
  });
}

export function analyzeSocialContextKg(input: SocialContextKgInput): SocialContextRuleMatch[] {
  const seed = input.seed ?? loadSocialContextKgSeed();
  const context = matchContext({ ...input, seed });

  const matches = dedupeRuleMatches(
    seed.socialRiskRules
      .filter((rule) => conditionMatches(rule, context))
      .map((rule) => ruleMatch(rule, context))
  );

  if (matches.length > 0) {
    input.onTrace?.({
      phase: "rule",
      nodeIds: [...new Set(matches.map((match) => match.rule.id))],
      riskLevel: matches[0].riskLevel,
      note: matches[0].rule.nameKo
    });
  }

  return matches;
}

export function socialContextKgEvidenceCandidate(
  match: SocialContextRuleMatch,
  index: number
): RagEvidenceCandidate {
  const eventNames = match.matchedEvents.map((event) => event.nameKo).slice(0, 2);
  const titleSuffix = eventNames.length > 0 ? eventNames.join(", ") : match.rule.nameKo;

  return {
    id: `social-context-kg-${normalizeForId(match.rule.id)}-${String(index + 1).padStart(3, "0")}`,
    sourceType: "internal_policy",
    documentId: `social-context-kg:${match.rule.id}`,
    chunkId: match.id,
    title: `사회맥락 KG: ${titleSuffix}`,
    section: match.rule.id,
    quoteSummary: [
      match.rationale,
      `탐지 경로: ${match.matchedPath.join(" → ")}`,
      match.matchedPriorCases.length > 0
        ? `유사 논란 유형: ${match.matchedPriorCases.map((priorCase) => priorCase.title).join(", ")}`
        : ""
    ]
      .filter(Boolean)
      .join(" "),
    relevanceScore: match.riskLevel === "high" ? 0.96 : match.riskLevel === "caution" ? 0.86 : 0.74
  };
}

function socialContextKgFindingTitle(match: SocialContextRuleMatch) {
  const event = match.matchedDate?.event ?? match.matchedEvents[0];
  const term = match.matchedTerms[0] ?? match.matchedSymbols[0];

  if (event && term) {
    return `${event.nameKo}와 '${term.labelKo}' 표현의 사회맥락 충돌 가능성`;
  }

  if (event) {
    return `${event.nameKo} 관련 사회맥락 리스크 검토 필요`;
  }

  return match.rule.nameKo;
}

function socialContextKgSuggestedCopy(match: SocialContextRuleMatch) {
  if (match.suggestedAction === "approve") {
    return "추모·공익·교육 등 안전 문맥이 유지되는지 확인하고, 상업적 혜택 표현과 혼동되지 않도록 문구를 유지해 주세요.";
  }

  if (match.suggestedAction === "change_request") {
    return "민감 사건·상징을 연상시키는 표현을 중립적인 금융 혜택 문구로 대체하고, 필요 시 게시일 또는 이미지 소재를 조정해 주세요.";
  }

  return "게시일, 캠페인명, 핵심 문구, 이미지 상징을 PR/브랜드/준법 담당자와 공동 검토한 뒤 집행 여부를 확정해 주세요.";
}

export function socialContextKgAgentFinding(
  match: SocialContextRuleMatch,
  evidenceCandidate: RagEvidenceCandidate,
  index: number
): AgentFinding {
  return {
    id: `finding-social_context_kg-${String(index + 1).padStart(3, "0")}-${normalizeForId(match.rule.id)}`,
    agent: "social_context_risk",
    issueType: `SOCIAL_CONTEXT_KG_${match.rule.id.toUpperCase()}`,
    riskLevel: match.riskLevel,
    title: socialContextKgFindingTitle(match),
    targetText: match.targetText,
    description: compact(`${match.rationale} 탐지 경로: ${match.matchedPath.join(" → ")}`),
    suggestedAction: match.suggestedAction,
    suggestedCopy: socialContextKgSuggestedCopy(match),
    evidenceCandidateIds: [evidenceCandidate.id],
    confidence: match.confidence,
    rawModelOutput: JSON.stringify({
      source: "social_context_kg",
      ruleId: match.rule.id,
      matchedPath: match.matchedPath
    })
  };
}

export function socialContextKgArtifacts(input: SocialContextKgInput): {
  matches: SocialContextRuleMatch[];
  evidenceCandidates: RagEvidenceCandidate[];
  agentFindings: AgentFinding[];
} {
  const matches = analyzeSocialContextKg(input);
  const evidenceCandidates = matches.map(socialContextKgEvidenceCandidate);
  const agentFindings = matches.map((match, index) =>
    socialContextKgAgentFinding(match, evidenceCandidates[index], index)
  );

  return { matches, evidenceCandidates, agentFindings };
}
