import { NextResponse } from "next/server";
import type { RiskLevel } from "@/domain/types";
import { ForbiddenError } from "@/server/auth/rbac";
import {
  getRequestContext,
  InvalidAuthTokenError,
  type RequestContext
} from "@/server/auth/request-context";

export type RouteContext<T extends Record<string, string>> = {
  params: Promise<T>;
};

export function jsonError(message: string, status: number, code = "REQUEST_ERROR") {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function jsonForbidden(error: unknown) {
  if (error instanceof InvalidAuthTokenError) {
    return jsonError(error.message, 401, "UNAUTHORIZED");
  }

  if (error instanceof ForbiddenError) {
    return jsonError(error.message, 403, "FORBIDDEN");
  }

  throw error;
}

export function requestContext(request: Request): Promise<RequestContext> {
  return getRequestContext(request);
}

export async function readJsonBody<T>(request: Request): Promise<T | undefined> {
  try {
    return (await request.json()) as T;
  } catch {
    return undefined;
  }
}

export function parseRiskLevel(value: string | null): RiskLevel | undefined {
  if (
    value === "info" ||
    value === "caution" ||
    value === "high" ||
    value === "reject_recommended"
  ) {
    return value;
  }

  return undefined;
}
