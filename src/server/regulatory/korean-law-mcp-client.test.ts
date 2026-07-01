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
