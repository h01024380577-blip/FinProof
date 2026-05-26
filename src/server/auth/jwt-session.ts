import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from "jose";
import type { RoleId } from "@/domain/types";

type Env = Record<string, string | undefined>;

export type JwtSessionClaims = {
  sub: string;
  tenant_id: string;
  role: RoleId;
};

const roles: RoleId[] = ["requester", "reviewer", "compliance_admin"];
const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export class InvalidAuthTokenError extends Error {
  constructor(message = "Invalid authentication token") {
    super(message);
    this.name = "InvalidAuthTokenError";
  }
}

function value(env: Env, key: string): string | undefined {
  const raw = env[key];

  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function jwtVerifyOptions(env: Env, algorithms: string[]): JWTVerifyOptions {
  return {
    algorithms,
    issuer: value(env, "FINPROOF_AUTH_JWT_ISSUER"),
    audience: value(env, "FINPROOF_AUTH_JWT_AUDIENCE")
  };
}

function remoteJwks(url: string) {
  const cached = remoteJwksCache.get(url);

  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL(url));
  remoteJwksCache.set(url, jwks);

  return jwks;
}

function parseVerifiedClaims(payload: Record<string, unknown>): JwtSessionClaims {
  if (typeof payload.sub !== "string" || typeof payload.tenant_id !== "string") {
    throw new InvalidAuthTokenError("JWT must include sub and tenant_id claims");
  }

  if (!roles.includes(payload.role as RoleId)) {
    throw new InvalidAuthTokenError("JWT role claim is not allowed");
  }

  return {
    sub: payload.sub,
    tenant_id: payload.tenant_id,
    role: payload.role as RoleId
  };
}

export async function verifyJwtSession(
  token: string,
  env: Env = process.env
): Promise<JwtSessionClaims> {
  const jwksUrl = value(env, "FINPROOF_AUTH_JWKS_URL");
  const secret = value(env, "FINPROOF_AUTH_JWT_SECRET");

  try {
    if (jwksUrl) {
      const { payload } = await jwtVerify(
        token,
        remoteJwks(jwksUrl),
        jwtVerifyOptions(env, ["RS256"])
      );

      return parseVerifiedClaims(payload);
    }

    if (!secret) {
      throw new InvalidAuthTokenError(
        "FINPROOF_AUTH_JWT_SECRET or FINPROOF_AUTH_JWKS_URL is required"
      );
    }

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      jwtVerifyOptions(env, ["HS256"])
    );

    return parseVerifiedClaims(payload);
  } catch (error) {
    if (error instanceof InvalidAuthTokenError) {
      throw error;
    }

    throw new InvalidAuthTokenError();
  }
}
