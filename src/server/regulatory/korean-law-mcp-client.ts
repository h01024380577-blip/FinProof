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

export type SearchLawResult = {
  lawId?: string;
  mst?: string;
  title?: string;
};

export type SearchAdminRuleResult = {
  /** 행정규칙일련번호 — get_admin_rule의 id 파라미터로 사용한다. */
  serialNo?: string;
  adminRuleId?: string;
  title?: string;
  promulgatedAt?: string;
};

export type GetAdminRuleTextResult = {
  text: string;
  effectiveFrom?: string;
  promulgatedAt?: string;
};

export type KoreanLawMcpClient = {
  getLawText(params: GetLawTextParams): Promise<GetLawTextResult>;
  searchLaw(query: string): Promise<SearchLawResult>;
  /** 행정규칙(감독규정·시행세칙·심의규정·지침 등) 검색. */
  searchAdminRule(query: string): Promise<SearchAdminRuleResult>;
  /** 행정규칙 전문 조회. serialNo = 행정규칙일련번호. */
  getAdminRuleText(serialNo: string): Promise<GetAdminRuleTextResult>;
};

function envValue(env: Env, key: string): string | undefined {
  const raw = env[key];
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function extractMcpText(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray((result as { content: unknown }).content)
  ) {
    return "";
  }

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

  return "";
}

function parseHeaderDate(text: string, label: string): string | undefined {
  // law.go.kr returns dates as either "YYYY-MM-DD" or bare "YYYYMMDD"; normalize to ISO.
  const match = text.match(new RegExp(`${label}\\s*[:：]\\s*([0-9]{4})-?([0-9]{2})-?([0-9]{2})`));
  if (!match) {
    return undefined;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
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

  async function callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const response = await fetchImpl(url, {
      method: "POST",
      signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000),
      // MCP streamable HTTP transport requires both media types in Accept, else 406.
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args
        }
      })
    });

    if (!response.ok) {
      throw new Error(
        `korean-law-mcp ${toolName} failed: ${response.status ?? "unknown"} ${
          response.statusText ?? ""
        }`.trim()
      );
    }

    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) {
      throw new Error(`korean-law-mcp returned error: ${body.error.message ?? "unknown"}`);
    }

    return extractMcpText(body.result).trim();
  }

  return {
    async getLawText(params) {
      const text = await callTool("get_law_text", {
        ...(params.lawId ? { lawId: params.lawId } : {}),
        ...(params.mst ? { MST: params.mst } : {}), // law.go.kr API expects uppercase "MST"
        ...(params.jo ? { jo: params.jo } : {})
      });

      return {
        text,
        effectiveFrom: parseHeaderDate(text, "시행일"),
        promulgatedAt: parseHeaderDate(text, "공포일"),
        isCurrent: text.includes("[현행]")
      };
    },

    async searchLaw(query) {
      const text = await callTool("search_law", { query, display: 1 });

      const mst = text.match(/(?:MST|일련번호)\s*[:：]?\s*(\d{4,})/)?.[1];
      const hasMstLabel = /(?:MST|일련번호)\s*[:：]/.test(text);
      // Only "법령ID" — a bare "ID" alternative would also match "행정규칙ID" in fallback output.
      const lawId =
        text.match(/(?:법령ID|lawId|LawId)\s*[:：]?\s*(\d{4,})/)?.[1] ??
        (hasMstLabel ? undefined : text.match(/\b(\d{6,})\b/)?.[1]);
      const title = text.match(/(?:법령명|법령명한글|title)\s*[:：]?\s*(.+)/)?.[1]?.trim();

      return {
        ...(lawId ? { lawId } : {}),
        ...(mst ? { mst } : {}),
        ...(title ? { title } : {})
      };
    },

    async searchAdminRule(query) {
      // 행정규칙(감독규정 등)은 법령 API가 아니라 execute_tool 프록시로 접근한다.
      const text = await callTool("execute_tool", {
        tool_name: "search_admin_rule",
        params: { query }
      });

      const serialNo = text.match(/행정규칙일련번호\s*[:：]?\s*(\d{6,})/)?.[1];
      const adminRuleId = text.match(/행정규칙ID\s*[:：]?\s*(\d+)/)?.[1];
      const title = text.match(/^\s*1\.\s*(.+?)\s*$/m)?.[1]?.trim();

      return {
        ...(serialNo ? { serialNo } : {}),
        ...(adminRuleId ? { adminRuleId } : {}),
        ...(title ? { title } : {}),
        ...(parseHeaderDate(text, "공포일") ? { promulgatedAt: parseHeaderDate(text, "공포일") } : {})
      };
    },

    async getAdminRuleText(serialNo) {
      const text = await callTool("execute_tool", {
        tool_name: "get_admin_rule",
        params: { id: serialNo }
      });

      return {
        text,
        effectiveFrom: parseHeaderDate(text, "시행일"),
        promulgatedAt: parseHeaderDate(text, "공포일")
      };
    }
  };
}
