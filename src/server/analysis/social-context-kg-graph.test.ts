import { buildSocialContextGraph } from "./social-context-kg-graph";
import { loadSocialContextKgSeed } from "./social-context-kg-loader";

describe("buildSocialContextGraph", () => {
  const graph = buildSocialContextGraph(loadSocialContextKgSeed());
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  it("authors a node for every seed collection the engine can reference", () => {
    const seed = loadSocialContextKgSeed();
    expect(graph.stats.typeCounts.Country).toBe(seed.countries.length);
    expect(graph.stats.typeCounts.SensitiveEvent).toBe(seed.sensitiveEvents.length);
    expect(graph.stats.typeCounts.SensitiveSymbol).toBe(seed.sensitiveSymbolsVisual.length);
    expect(graph.stats.typeCounts.FinancialPromoTerm).toBe(seed.financialPromoTerms.length);
    // every canonical id resolves to a node
    for (const event of seed.sensitiveEvents) expect(nodeIds.has(event.id)).toBe(true);
    for (const slang of seed.derogatorySocialSlang) expect(nodeIds.has(slang.id)).toBe(true);
  });

  it("maps every edge to the full 546-edge set with resolvable endpoints", () => {
    const seed = loadSocialContextKgSeed();
    expect(graph.edges.length).toBe(seed.socialKgEdges.length);
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }
  });

  it("synthesizes inferred nodes (dates, stakeholders) from edge endpoints", () => {
    expect(graph.stats.inferredNodes).toBeGreaterThan(0);
    expect(nodeIds.has("date-04-17")).toBe(true);
    const stakeholderNodes = graph.nodes.filter((node) => node.type === "Stakeholder");
    expect(stakeholderNodes.length).toBeGreaterThan(0);
    expect(stakeholderNodes.every((node) => node.virtual)).toBe(true);
  });

  it("computes node degrees from edges", () => {
    const cambodiaGenocide = graph.nodes.find((node) => node.id === "khm-khmer-rouge-genocide");
    expect(cambodiaGenocide?.degree).toBeGreaterThan(0);
  });
});
