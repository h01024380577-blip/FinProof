import { NextResponse } from "next/server";
import { requireRole } from "@/server/auth/rbac";
import { getBackendRuntimeConfig, redactedBackendRuntimeConfig } from "@/server/ops/backend-config";
import { jsonForbidden, requestContext } from "@/server/reviews/route-utils";

export async function GET(request: Request) {
  try {
    requireRole(await requestContext(request), ["compliance_admin"], "read backend readiness");
  } catch (error) {
    return jsonForbidden(error);
  }

  const config = redactedBackendRuntimeConfig(getBackendRuntimeConfig());

  return NextResponse.json(
    {
      readiness: config.productionReady ? "ready" : "not_ready",
      config
    },
    { status: config.productionReady ? 200 : 503 }
  );
}
