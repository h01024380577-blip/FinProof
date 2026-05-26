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

export type QueryParseResult<T> =
  | { ok: true; value: T | undefined }
  | { ok: false; message: string };

export function jsonError(message: string, status: number, code = "REQUEST_ERROR") {
  return NextResponse.json({ error: { code, message } }, { status });
}

export class StateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateConflictError";
  }
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

export function jsonRouteError(error: unknown) {
  if (error instanceof StateConflictError) {
    return jsonError(error.message, 409, "STATE_CONFLICT");
  }

  return jsonForbidden(error);
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

export function parseOptionalQueryString(value: string | null): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

export function parsePositiveIntegerQuery(
  value: string | null,
  label: "page" | "pageSize",
  defaultValue: number
): QueryParseResult<number> {
  const trimmed = parseOptionalQueryString(value);

  if (!trimmed) {
    return { ok: true, value: defaultValue };
  }

  if (!/^[1-9]\d*$/.test(trimmed)) {
    return { ok: false, message: `${label} must be a positive integer` };
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < 1 || !Number.isFinite(parsed)) {
    return { ok: false, message: `${label} must be a positive integer` };
  }

  return { ok: true, value: parsed };
}

export function parsePageSizeQuery(
  value: string | null,
  options: { defaultValue?: number; max?: number } = {}
): QueryParseResult<number> {
  const max = options.max ?? 100;
  const parsed = parsePositiveIntegerQuery(value, "pageSize", options.defaultValue ?? 20);

  if (!parsed.ok) {
    return { ok: false, message: `pageSize must be between 1 and ${max}` };
  }

  if (parsed.value && parsed.value > max) {
    return { ok: false, message: `pageSize must be between 1 and ${max}` };
  }

  return parsed;
}
