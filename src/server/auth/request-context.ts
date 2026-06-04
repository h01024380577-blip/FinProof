import { SignJWT } from "jose";
import type { RoleId } from "@/domain/types";
import { InvalidAuthTokenError, verifyJwtSession } from "./jwt-session";

export type RequestContext = {
  tenantId: string;
  userId: string;
  userName?: string;
  role: RoleId;
  ipAddress?: string;
};

const roles: RoleId[] = ["requester", "reviewer", "compliance_admin"];

function parseRole(value: string | null): RoleId {
  return roles.includes(value as RoleId) ? (value as RoleId) : "reviewer";
}

function firstForwardedIp(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function optionalHeaderValue(value: string | null): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function demoUserName(value: string | null): string | undefined {
  const raw = optionalHeaderValue(value);

  if (!raw) {
    return undefined;
  }

  try {
    return optionalHeaderValue(decodeURIComponent(raw));
  } catch {
    return raw;
  }
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const [scheme, token] = authorization?.split(/\s+/, 2) ?? [];

  if (scheme !== "Bearer" || !token) {
    throw new InvalidAuthTokenError("Bearer token is required");
  }

  return token;
}

async function getJwtRequestContext(request: Request): Promise<RequestContext> {
  const payload = await verifyJwtSession(getBearerToken(request));

  return {
    tenantId: payload.tenant_id,
    userId: payload.sub,
    role: payload.role,
    ipAddress: firstForwardedIp(request.headers.get("x-forwarded-for"))
  };
}

export async function createHs256JwtForTests(
  claims: Record<string, unknown>,
  secret: string
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(new TextEncoder().encode(secret));
}

export async function getRequestContext(request: Request): Promise<RequestContext> {
  if (process.env.FINPROOF_AUTH_MODE === "jwt") {
    return getJwtRequestContext(request);
  }

  const role = parseRole(request.headers.get("x-finproof-role"));
  const userName = demoUserName(request.headers.get("x-finproof-user-name"));
  const fallbackUserId =
    role === "requester"
      ? (process.env.FINPROOF_DEFAULT_REQUESTER_USER_ID ?? "user-requester-demo")
      : (process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo");

  return {
    tenantId:
      request.headers.get("x-finproof-tenant-id") ??
      process.env.FINPROOF_DEFAULT_TENANT_ID ??
      "tenant-demo",
    userId: request.headers.get("x-finproof-user-id") ?? fallbackUserId,
    ...(userName ? { userName } : {}),
    role,
    ipAddress: firstForwardedIp(request.headers.get("x-forwarded-for"))
  };
}

export { InvalidAuthTokenError };
