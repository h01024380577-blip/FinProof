// @vitest-environment node

import { createHs256JwtForTests } from "@/server/auth/request-context";
import { GET as readinessGET } from "@/app/api/v1/ops/readiness/route";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/v1/ops/readiness", { headers });
}

describe("ops readiness route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("requires compliance admin access", async () => {
    const response = await readinessGET(request({ "x-finproof-role": "reviewer" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns redacted production readiness for admin JWT sessions", async () => {
    process.env.FINPROOF_AUTH_MODE = "jwt";
    process.env.FINPROOF_AUTH_JWT_SECRET = "jwt-secret";
    process.env.FINPROOF_REVIEW_STORE = "prisma";
    process.env.FINPROOF_MODEL_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-real";
    process.env.FINPROOF_OCR_PROVIDER = "http";
    process.env.FINPROOF_OCR_ENDPOINT = "https://ocr.example.com/extract";
    process.env.FINPROOF_RAG_PROVIDER = "postgres";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.FINPROOF_RERANK_PROVIDER = "http";
    process.env.FINPROOF_RERANK_ENDPOINT = "https://rerank.example.com/rerank";
    process.env.FINPROOF_UPLOAD_SCAN_PROVIDER = "http";
    process.env.FINPROOF_UPLOAD_SCAN_ENDPOINT = "https://scanner.example.com/scan";
    process.env.FINPROOF_STORAGE_ADAPTER = "s3";
    process.env.FINPROOF_S3_BUCKET = "finproof-prod-artifacts";
    process.env.AWS_REGION = "ap-northeast-2";

    const token = await createHs256JwtForTests(
      { sub: "admin-user", tenant_id: "tenant-prod", role: "compliance_admin" },
      "jwt-secret"
    );
    const response = await readinessGET(request({ authorization: `Bearer ${token}` }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      readiness: "ready",
      config: {
        productionReady: true,
        secrets: {
          FINPROOF_AUTH_JWT_SECRET: "set",
          OPENAI_API_KEY: "set"
        }
      }
    });
    expect(JSON.stringify(body)).not.toContain("sk-real");
    expect(JSON.stringify(body)).not.toContain("jwt-secret");
  });
});
