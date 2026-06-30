// src/server/regulatory/korean-law-mcp-client.ts
type Env = Record<string, string | undefined>;

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{ ok: boolean; status?: number; statusText?: string; json(): Promise<unknown> }>;

export type GetLawTextParams = {
  /** law.go.kr law id 또는 MST 중 하나 */
  lawId?: string;
  mst?: string;
  /** 특정 조문만 필요할 때(옵션) */
  jo?: string;
};

export type GetLawTextResult = {
  text: string;
  effectiveFrom?: string;
  promulgatedAt?: string;
  isCurrent: boolean;
};

export type KoreanLawMcpClient = {
  getLawText(params: GetLawTextParams): Promise<GetLawTextResult>;
};

function envValue(env: Env, key: string): string | undefined {
  const raw = env[key];
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function extractMcpText(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown[] }).content)
  ) {
    for (const part of (result as { content: unknown[] }).content) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type: unknown }).type === "text" &&
        "text" in part &&
        typeof (part as { text: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function parseHeaderDate(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`${label}\\s*[:：]\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})`));
  return match?.[1];
}

export function createKoreanLawMcpClient(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch
): KoreanLawMcpClient {
  const baseUrl =
    envValue(env, "KOREAN_LAW_MCP_URL") ?? "https://korean-law-mcp.fly.dev/mcp";
  const oc = envValue(env, "LAW_API_OC") ?? envValue(env, "LAW_OC");
  const timeoutMs = Number(envValue(env, "KOREAN_LAW_MCP_TIMEOUT_MS") ?? "60000");
  const url = oc ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}oc=${encodeURIComponent(oc)}` : baseUrl;

  return {
    async getLawText(params) {
      const response = await fetchImpl(url, {
        method: "POST",
        signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000),
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "get_law_text",
            arguments: {
              ...(params.lawId ? { lawId: params.lawId } : {}),
              ...(params.mst ? { MST: params.mst } : {}),
              ...(params.jo ? { jo: params.jo } : {})
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(
          `korean-law-mcp get_law_text failed: ${response.status ?? "unknown"} ${
            response.statusText ?? ""
          }`.trim()
        );
      }

      const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) {
        throw new Error(`korean-law-mcp returned error: ${body.error.message ?? "unknown"}`);
      }

      const text = extractMcpText(body.result).trim();
      return {
        text,
        effectiveFrom: parseHeaderDate(text, "시행일"),
        promulgatedAt: parseHeaderDate(text, "공포일"),
        isCurrent: text.includes("[현행]")
      };
    }
  };
}
