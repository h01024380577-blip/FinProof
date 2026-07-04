import type { SocialContextKgSeed } from "@/domain/social-context-kg";

/**
 * Serializable knowledge-graph shape consumed by the live viewer (`/social-kg-live`).
 * Node ids are the canonical KG ids used across the engine result (`matched*[].id`)
 * and `social-kg-edges.json`, so a trace event's `nodeIds` always resolve to a node
 * here. Built as a pure transform of the bundled seed via `buildSocialContextGraph`.
 */
export type SocialContextGraphNode = {
  id: string;
  type: string;
  labelKo: string;
  labelEn: string;
  labelLocal: string;
  countryId: string;
  sensitivityLevel: string;
  aliases: string[];
  sourceRefs: string[];
  metadata: Record<string, unknown>;
  virtual: boolean;
  degree: number;
};

export type SocialContextGraphEdge = {
  id: string;
  from: string;
  to: string;
  relation: string;
  weight: number;
  countryId: string;
  note: string;
};

export type SocialContextGraphStats = {
  authoredNodes: number;
  inferredNodes: number;
  totalNodes: number;
  totalEdges: number;
  typeCounts: Record<string, number>;
  countryCounts: Record<string, number>;
  riskCounts: Record<string, number>;
  relationCounts: Record<string, number>;
  highRiskEvents: number;
};

export type SocialContextGraph = {
  nodes: SocialContextGraphNode[];
  edges: SocialContextGraphEdge[];
  stats: SocialContextGraphStats;
};

const GLOBAL = "global";

function normalizeLevel(level: string | undefined): string {
  return level && level.length > 0 ? level : "none";
}

function inferVirtualType(id: string): string {
  if (id.startsWith("date-")) return "Date";
  if (id.startsWith("stakeholder-")) return "Stakeholder";
  if (id.startsWith("region-")) return "Region";
  if (id.startsWith("target-")) return "TargetGroup";
  if (id.startsWith("term-")) return "SensitiveTerm";
  return "Concept";
}

function virtualLabel(id: string): string {
  const dateMatch = id.match(/^date-(\d{2})-(\d{2})$/);

  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2]}`;
  }

  return id.replace(/^(stakeholder|region|target|term)-/, "").replace(/-/g, " ");
}

/**
 * Deterministically transform the bundled KG seed into `{ nodes, edges, stats }`.
 * Authors first-class nodes for every seed collection the sub-agent can reference
 * (countries, events, terms, symbols, financial promo terms, campaign intents,
 * derogatory slang) and synthesizes inferred nodes (dates, stakeholders, regions,
 * target groups) from edge endpoints not present as authored nodes.
 */
export function buildSocialContextGraph(seed: SocialContextKgSeed): SocialContextGraph {
  const nodes: SocialContextGraphNode[] = [];
  const byId = new Map<string, SocialContextGraphNode>();

  const addNode = (node: SocialContextGraphNode) => {
    if (byId.has(node.id)) {
      return;
    }

    byId.set(node.id, node);
    nodes.push(node);
  };

  for (const country of seed.countries) {
    addNode({
      id: country.countryId,
      type: "Country",
      labelKo: country.nameKo ?? country.countryId,
      labelEn: country.nameEn ?? "",
      labelLocal: country.nameLocal ?? "",
      countryId: country.countryId,
      sensitivityLevel: "none",
      aliases: [country.nameKo, country.nameEn, country.nameLocal].filter(
        (value): value is string => Boolean(value)
      ),
      sourceRefs: [],
      metadata: { languages: country.languages ?? [] },
      virtual: false,
      degree: 0
    });
  }

  for (const event of seed.sensitiveEvents) {
    addNode({
      id: event.id,
      type: "SensitiveEvent",
      labelKo: event.nameKo,
      labelEn: event.nameEn ?? "",
      labelLocal: event.nameLocal ?? "",
      countryId: event.countryId,
      sensitivityLevel: normalizeLevel(event.sensitivityLevel),
      aliases: event.aliases ?? [],
      sourceRefs: event.sourceRefs ?? [],
      metadata: {
        dates: event.dates ?? [],
        eventType: event.eventType ?? [],
        reviewPolicy: event.reviewPolicy ?? ""
      },
      virtual: false,
      degree: 0
    });
  }

  for (const term of seed.sensitiveEventTerms) {
    addNode({
      id: term.id,
      type: "SensitiveTerm",
      labelKo: term.labelKo,
      labelEn: term.labelEn ?? "",
      labelLocal: term.labelLocal ?? "",
      countryId: term.countryId,
      sensitivityLevel: normalizeLevel(term.sensitivityLevel),
      aliases: term.aliases ?? [],
      sourceRefs: term.sourceRefs ?? [],
      metadata: { termType: term.termType ?? "", associatedEventIds: term.associatedEventIds ?? [] },
      virtual: false,
      degree: 0
    });
  }

  for (const symbol of seed.sensitiveSymbolsVisual) {
    addNode({
      id: symbol.id,
      type: "SensitiveSymbol",
      labelKo: symbol.labelKo,
      labelEn: symbol.labelEn ?? "",
      labelLocal: symbol.labelLocal ?? "",
      countryId: symbol.countryId,
      sensitivityLevel: normalizeLevel(symbol.sensitivityLevel),
      aliases: symbol.aliases ?? [],
      sourceRefs: symbol.sourceRefs ?? [],
      metadata: {
        symbolType: symbol.symbolType ?? "",
        associatedEventIds: symbol.associatedEventIds ?? []
      },
      virtual: false,
      degree: 0
    });
  }

  for (const term of seed.financialPromoTerms) {
    addNode({
      id: term.id,
      type: "FinancialPromoTerm",
      labelKo: term.labelKo,
      labelEn: term.labelEn ?? "",
      labelLocal: "",
      countryId: GLOBAL,
      sensitivityLevel: "none",
      aliases: term.aliases ?? [],
      sourceRefs: [],
      metadata: { category: term.category ?? "", productTypes: term.productTypes ?? [] },
      virtual: false,
      degree: 0
    });
  }

  for (const intent of seed.campaignIntents) {
    addNode({
      id: intent.id,
      type: "Concept",
      labelKo: intent.labelKo,
      labelEn: "",
      labelLocal: "",
      countryId: GLOBAL,
      sensitivityLevel: "none",
      aliases: intent.aliases ?? [],
      sourceRefs: [],
      metadata: { commercialityWeight: intent.commercialityWeight ?? 0 },
      virtual: false,
      degree: 0
    });
  }

  for (const slang of seed.derogatorySocialSlang) {
    addNode({
      id: slang.id,
      type: "SensitiveTerm",
      labelKo: slang.surfaceForms[0] ?? slang.id,
      labelEn: "",
      labelLocal: "",
      countryId: "south_korea",
      sensitivityLevel: normalizeLevel(slang.defaultRisk),
      aliases: slang.surfaceForms,
      sourceRefs: [],
      metadata: { category: slang.category, targetGroups: slang.targetGroups ?? [] },
      virtual: false,
      degree: 0
    });
  }

  const authoredNodes = nodes.length;

  const edges: SocialContextGraphEdge[] = seed.socialKgEdges.map((edge, index) => ({
    id: `edge-${index + 1}`,
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    weight: typeof edge.weight === "number" ? edge.weight : 1,
    countryId: edge.countryId ?? GLOBAL,
    note: edge.note ?? ""
  }));

  // Synthesize inferred nodes for edge endpoints without an authored node.
  for (const edge of edges) {
    for (const endpoint of [edge.from, edge.to]) {
      if (byId.has(endpoint)) {
        continue;
      }

      addNode({
        id: endpoint,
        type: inferVirtualType(endpoint),
        labelKo: virtualLabel(endpoint),
        labelEn: "",
        labelLocal: "",
        countryId: edge.countryId ?? GLOBAL,
        sensitivityLevel: "none",
        aliases: [],
        sourceRefs: [],
        metadata: {},
        virtual: true,
        degree: 0
      });
    }
  }

  // Degrees.
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);

    if (from) from.degree += 1;
    if (to) to.degree += 1;
  }

  const typeCounts: Record<string, number> = {};
  const countryCounts: Record<string, number> = {};
  const riskCounts: Record<string, number> = {};

  for (const node of nodes) {
    typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;
    countryCounts[node.countryId] = (countryCounts[node.countryId] ?? 0) + 1;
    riskCounts[node.sensitivityLevel] = (riskCounts[node.sensitivityLevel] ?? 0) + 1;
  }

  const relationCounts: Record<string, number> = {};

  for (const edge of edges) {
    relationCounts[edge.relation] = (relationCounts[edge.relation] ?? 0) + 1;
  }

  const highRiskEvents = nodes.filter(
    (node) => node.type === "SensitiveEvent" && node.sensitivityLevel === "high"
  ).length;

  return {
    nodes,
    edges,
    stats: {
      authoredNodes,
      inferredNodes: nodes.length - authoredNodes,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      typeCounts,
      countryCounts,
      riskCounts,
      relationCounts,
      highRiskEvents
    }
  };
}
