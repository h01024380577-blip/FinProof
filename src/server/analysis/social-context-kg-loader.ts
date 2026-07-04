import type { SocialContextKgSeed } from "@/domain/social-context-kg";

import campaignIntents from "../../../data/social-context/global-merged/combined/campaign-intents.json";
import countries from "../../../data/social-context/global-merged/combined/countries.json";
import financialPromoTerms from "../../../data/social-context/global-merged/combined/financial-promo-terms.json";
import priorControversyCases from "../../../data/social-context/global-merged/combined/prior-controversy-cases.json";
import safeContexts from "../../../data/social-context/global-merged/combined/safe-contexts.json";
import sensitiveEventTerms from "../../../data/social-context/global-merged/combined/sensitive-event-terms.json";
import sensitiveEvents from "../../../data/social-context/global-merged/combined/sensitive-events.json";
import sensitiveSymbolsVisual from "../../../data/social-context/global-merged/combined/sensitive-symbols-visual.json";
import socialKgEdges from "../../../data/social-context/global-merged/combined/social-kg-edges.json";
import socialRiskRules from "../../../data/social-context/global-merged/combined/social-risk-rules.json";
import derogatorySocialSlang from "../../../data/social-context/global-merged/by-country/south-korea/derogatory-social-slang.json";

let cachedSeed: SocialContextKgSeed | undefined;

export function loadSocialContextKgSeed(): SocialContextKgSeed {
  cachedSeed ??= {
    countries,
    sensitiveEvents,
    sensitiveEventTerms,
    sensitiveSymbolsVisual,
    financialPromoTerms,
    campaignIntents,
    socialKgEdges,
    socialRiskRules,
    safeContexts,
    priorControversyCases,
    derogatorySocialSlang
  } as SocialContextKgSeed;

  return cachedSeed;
}
