import "dotenv/config";
import { createKoreanLawMcpClient } from "@/server/regulatory/korean-law-mcp-client";

// Read-only verification: no DB writes. Confirms the korean-law-mcp data path
// (search_law -> get_law_text) actually returns real, current 법령 text.
async function main() {
  const query = process.argv.slice(2).join(" ") || "금융소비자 보호에 관한 법률";
  const client = createKoreanLawMcpClient();

  console.log(`[verify] MCP URL: ${process.env.KOREAN_LAW_MCP_URL ?? "https://korean-law-mcp.fly.dev/mcp (fallback)"}`);
  console.log(`[verify] OC set: ${Boolean(process.env.LAW_API_OC || process.env.LAW_OC)}`);
  console.log(`[verify] search_law query: ${query}`);

  const found = await client.searchLaw(query);
  console.log(`[verify] search_law result:`, JSON.stringify(found));

  const identifier = found.lawId ? { lawId: found.lawId } : found.mst ? { mst: found.mst } : null;
  if (!identifier) {
    console.log("[verify] ❌ could not resolve a law identifier from search_law");
    return;
  }

  const law = await client.getLawText(identifier);
  console.log(`[verify] get_law_text: chars=${law.text.length} effectiveFrom=${law.effectiveFrom ?? "?"} promulgatedAt=${law.promulgatedAt ?? "?"} isCurrent=${law.isCurrent}`);
  console.log("[verify] --- first 500 chars ---");
  console.log(law.text.slice(0, 500));
  console.log("[verify] --- end ---");
  console.log(law.text.length > 0 ? "[verify] ✅ real law text fetched" : "[verify] ❌ empty text");
}

main().catch((error) => {
  console.error("[verify] fatal:", error);
  process.exit(1);
});
