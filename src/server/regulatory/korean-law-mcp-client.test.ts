// src/server/regulatory/korean-law-mcp-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { createKoreanLawMcpClient } from "./korean-law-mcp-client";

function mockFetch(jsonRpcResult: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return { jsonrpc: "2.0", id: 1, result: jsonRpcResult };
    }
  }));
}

describe("createKoreanLawMcpClient", () => {
  it("calls tools/call with get_law_text and returns the text content", async () => {
    const fetchImpl = mockFetch({
      content: [{ type: "text", text: "공포일: 2026-01-01\n시행일: 2026-07-01\n[현행]\n제1조 본문" }]
    });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "honggildong" },
      fetchImpl as never
    );

    const result = await client.getLawText({ lawId: "123456" });

    expect(result.text).toContain("제1조 본문");
    expect(result.effectiveFrom).toBe("2026-07-01");

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("get_law_text");
    expect(body.params.arguments.lawId).toBe("123456");
  });

  it("sends Accept: application/json, text/event-stream (MCP streamable HTTP requires it)", async () => {
    const fetchImpl = mockFetch({ content: [{ type: "text", text: "제1조" }] });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "x" },
      fetchImpl as never
    );

    await client.getLawText({ lawId: "1" });

    const [, init] = fetchImpl.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.accept).toContain("text/event-stream");
    expect(headers.accept).toContain("application/json");
  });

  it("parses bare YYYYMMDD dates from get_law_text into ISO", async () => {
    const fetchImpl = mockFetch({
      content: [{ type: "text", text: "법령명: 금융소비자 보호에 관한 법률\n공포일: 20251001\n시행일: 20260102\n제1조" }]
    });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "x" },
      fetchImpl as never
    );

    const result = await client.getLawText({ lawId: "013704" });

    expect(result.effectiveFrom).toBe("2026-01-02");
    expect(result.promulgatedAt).toBe("2025-10-01");
  });

  it("falls back to the public fly.dev endpoint when KOREAN_LAW_MCP_URL is unset", async () => {
    const fetchImpl = mockFetch({ content: [{ type: "text", text: "[현행]\n제1조" }] });
    const client = createKoreanLawMcpClient({ LAW_API_OC: "honggildong" }, fetchImpl as never);

    await client.getLawText({ lawId: "1" });

    const [calledUrl] = fetchImpl.mock.calls[0];
    expect(String(calledUrl)).toContain("korean-law-mcp.fly.dev");
    expect(String(calledUrl)).toContain("oc=honggildong");
  });

  it("searchLaw calls tools/call with search_law and parses the first law id", async () => {
    const fetchImpl = mockFetch({
      content: [{ type: "text", text: "법령명: 금융소비자 보호에 관한 법률\n법령ID: 001234\nMST: 267581" }]
    });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "honggildong" },
      fetchImpl as never
    );

    const result = await client.searchLaw("금융소비자 보호에 관한 법률");

    expect(result.lawId).toBe("001234");
    expect(result.mst).toBe("267581");
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.params.name).toBe("search_law");
    expect(body.params.arguments.query).toBe("금융소비자 보호에 관한 법률");
  });

  it("searchLaw extracts the hit title from the '1. <name> [현행]' list format", async () => {
    const fetchImpl = mockFetch({
      content: [
        {
          type: "text",
          text: "검색 결과 (총 1건):\n📍 정확매칭 (1건):\n1. 금융소비자 보호에 관한 법률 [현행]\n   - 법령ID: 013704\n   - MST: 277247"
        }
      ]
    });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "x" },
      fetchImpl as never
    );

    const result = await client.searchLaw("금융소비자 보호에 관한 법률");

    expect(result.title).toBe("금융소비자 보호에 관한 법률");
    expect(result.lawId).toBe("013704");
  });

  it("searchLaw does not mistake an MST-only response for a lawId", async () => {
    const fetchImpl = mockFetch({
      content: [{ type: "text", text: "법령명: 어떤 규정\nMST: 267581" }]
    });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "x" },
      fetchImpl as never
    );
    const result = await client.searchLaw("어떤 규정");
    expect(result.lawId).toBeUndefined();
    expect(result.mst).toBe("267581");
  });

  it("searchLaw ignores 행정규칙ID from a fallback response (no bare-ID mis-parse)", async () => {
    const fetchImpl = mockFetch({
      content: [
        {
          type: "text",
          text: "[FALLBACK] 법령 0건 → 행정규칙으로 자동 폴백.\n\n1. 은행업감독규정\n   - 행정규칙일련번호: 2100000272466\n   - 행정규칙ID: 36071\n   - 공포일: 20260102"
        }
      ]
    });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "x" },
      fetchImpl as never
    );

    const result = await client.searchLaw("은행업감독규정");
    // 36071 (행정규칙ID) must NOT be treated as a lawId; 일련번호 label suppresses the bare-number fallback.
    expect(result.lawId).toBeUndefined();
  });

  it("searchAdminRule parses 행정규칙일련번호 and title via execute_tool", async () => {
    const fetchImpl = mockFetch({
      content: [
        {
          type: "text",
          text: "행정규칙 검색 결과 (총 2건):\n\n1. 금융소비자 보호에 관한 감독규정\n   - 행정규칙일련번호: 2100000276850\n   - 행정규칙ID: 77048\n   - 공포일: 20260402\n   - 구분: 고시"
        }
      ]
    });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "x" },
      fetchImpl as never
    );

    const result = await client.searchAdminRule("금융소비자 보호에 관한 감독규정");

    expect(result.serialNo).toBe("2100000276850");
    expect(result.adminRuleId).toBe("77048");
    expect(result.title).toBe("금융소비자 보호에 관한 감독규정");
    expect(result.promulgatedAt).toBe("2026-04-02");

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.params.name).toBe("execute_tool");
    expect(body.params.arguments.tool_name).toBe("search_admin_rule");
    expect(body.params.arguments.params.query).toBe("금융소비자 보호에 관한 감독규정");
  });

  it("getAdminRuleText fetches full text via execute_tool get_admin_rule", async () => {
    const fetchImpl = mockFetch({
      content: [{ type: "text", text: "행정규칙명: 금융소비자 보호에 관한 감독규정\n종류: 고시\n\n---\n\n제1조(목적) ..." }]
    });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "x" },
      fetchImpl as never
    );

    const result = await client.getAdminRuleText("2100000276850");

    expect(result.text).toContain("제1조(목적)");
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.params.arguments.tool_name).toBe("get_admin_rule");
    expect(body.params.arguments.params.id).toBe("2100000276850");
  });

  it("searchLaw returns empty object when nothing parses", async () => {
    const fetchImpl = mockFetch({ content: [{ type: "text", text: "검색 결과가 없습니다." }] });
    const client = createKoreanLawMcpClient(
      { KOREAN_LAW_MCP_URL: "https://example.test/mcp", LAW_API_OC: "x" },
      fetchImpl as never
    );
    const result = await client.searchLaw("존재하지 않는 법령");
    expect(result).toEqual({});
  });
});
