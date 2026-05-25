import { NextResponse } from "next/server";
import type { RiskLevel } from "@/domain/types";

export type RouteContext<T extends Record<string, string>> = {
  params: Promise<T>;
};

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
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
