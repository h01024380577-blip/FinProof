import { NextResponse } from "next/server";
import { buildSocialContextGraph } from "@/server/analysis/social-context-kg-graph";
import { loadSocialContextKgSeed } from "@/server/analysis/social-context-kg-loader";
import kgMetadata from "../../../../../../data/social-context/global-merged/combined/kg-metadata.json";
import kgSchema from "../../../../../../data/social-context/global-merged/combined/kg-schema.json";

/**
 * Exposes the bundled social-context knowledge graph as `{ nodes, edges, stats, ... }`
 * for the live viewer (`/social-kg-live`). Static seed data — safe to serve; still
 * behind the `/api/v1/*` auth proxy (`src/proxy.ts`). Cached in-process by the loader.
 */
export function GET() {
  const seed = loadSocialContextKgSeed();
  const graph = buildSocialContextGraph(seed);

  return NextResponse.json({
    metadata: kgMetadata,
    schema: kgSchema,
    stats: graph.stats,
    nodes: graph.nodes,
    edges: graph.edges,
    riskRules: seed.socialRiskRules,
    safeContexts: seed.safeContexts,
    priorCases: seed.priorControversyCases
  });
}
