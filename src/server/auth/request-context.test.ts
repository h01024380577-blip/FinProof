// @vitest-environment node

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ForbiddenError, requireRole } from "./rbac";
import {
  createHs256JwtForTests,
  getRequestContext,
  InvalidAuthTokenError
} from "./request-context";

function requestWithHeaders(headers: Record<string, string>) {
  return new Request("http://localhost/api/v1/review-cases", { headers });
}

async function serveJwks(jwks: Record<string, unknown>) {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(jwks));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}/.well-known/jwks.json`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  };
}

describe("request context", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to reviewer context for local demo requests", async () => {
    const context = await getRequestContext(requestWithHeaders({}));

    expect(context).toMatchObject({
      tenantId: "tenant-demo",
      userId: "user-reviewer-demo",
      role: "reviewer"
    });
  });

  it("parses explicit requester headers", async () => {
    const context = await getRequestContext(
      requestWithHeaders({
        "x-finproof-tenant-id": "tenant-a",
        "x-finproof-user-id": "user-a",
        "x-finproof-role": "requester",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1"
      })
    );

    expect(context).toEqual({
      tenantId: "tenant-a",
      userId: "user-a",
      role: "requester",
      ipAddress: "203.0.113.10"
    });
  });

  it("parses demo requester display name headers", async () => {
    const context = await getRequestContext(
      requestWithHeaders({
        "x-finproof-role": "requester",
        "x-finproof-user-name": encodeURIComponent("요청자 김지현")
      })
    );

    expect(context).toMatchObject({
      role: "requester",
      userName: "요청자 김지현"
    });
  });

  it("rejects requester for reviewer-only operations", () => {
    expect(() => {
      requireRole(
        { tenantId: "tenant-demo", userId: "user-requester-demo", role: "requester" },
        ["reviewer", "compliance_admin"],
        "start analysis"
      );
    }).toThrow(ForbiddenError);
  });

  it("parses production JWT bearer sessions", async () => {
    process.env.FINPROOF_AUTH_MODE = "jwt";
    process.env.FINPROOF_AUTH_JWT_SECRET = "test-secret";
    const token = await createHs256JwtForTests(
      { sub: "user-admin", tenant_id: "tenant-prod", role: "compliance_admin" },
      "test-secret"
    );

    const context = await getRequestContext(
      requestWithHeaders({
        authorization: `Bearer ${token}`,
        "x-forwarded-for": "198.51.100.22"
      })
    );

    expect(context).toEqual({
      tenantId: "tenant-prod",
      userId: "user-admin",
      role: "compliance_admin",
      ipAddress: "198.51.100.22"
    });
  });

  it("verifies production JWT bearer sessions against a JWKS issuer", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    const server = await serveJwks({
      keys: [{ ...publicJwk, kid: "finproof-test-key", alg: "RS256", use: "sig" }]
    });

    try {
      process.env.FINPROOF_AUTH_MODE = "jwt";
      process.env.FINPROOF_AUTH_JWKS_URL = server.url;
      process.env.FINPROOF_AUTH_JWT_ISSUER = "https://auth.example.com/";
      process.env.FINPROOF_AUTH_JWT_AUDIENCE = "finproof-agent";

      const token = await new SignJWT({
        tenant_id: "tenant-prod",
        role: "compliance_admin"
      })
        .setProtectedHeader({ alg: "RS256", kid: "finproof-test-key" })
        .setSubject("user-admin")
        .setIssuer("https://auth.example.com/")
        .setAudience("finproof-agent")
        .setExpirationTime("2h")
        .sign(privateKey);

      const context = await getRequestContext(
        requestWithHeaders({
          authorization: `Bearer ${token}`,
          "x-forwarded-for": "198.51.100.22"
        })
      );

      expect(context).toEqual({
        tenantId: "tenant-prod",
        userId: "user-admin",
        role: "compliance_admin",
        ipAddress: "198.51.100.22"
      });
    } finally {
      await server.close();
    }
  });

  it("rejects invalid production JWT bearer sessions", async () => {
    process.env.FINPROOF_AUTH_MODE = "jwt";
    process.env.FINPROOF_AUTH_JWT_SECRET = "test-secret";
    const token = await createHs256JwtForTests(
      { sub: "user-admin", tenant_id: "tenant-prod", role: "compliance_admin" },
      "wrong-secret"
    );

    await expect(
      getRequestContext(requestWithHeaders({ authorization: `Bearer ${token}` }))
    ).rejects.toThrow(InvalidAuthTokenError);
  });
});
