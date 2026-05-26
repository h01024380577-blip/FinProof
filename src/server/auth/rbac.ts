import type { RoleId } from "@/domain/types";
import type { RequestContext } from "./request-context";

const roleLabels: Record<RoleId, string> = {
  requester: "Requester",
  reviewer: "Reviewer",
  compliance_admin: "Compliance Admin"
};

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function requireRole(context: RequestContext, allowedRoles: RoleId[], actionLabel: string) {
  if (!allowedRoles.includes(context.role)) {
    throw new ForbiddenError(
      `${allowedRoles.map((role) => roleLabels[role]).join(" or ")} role is required to ${actionLabel}`
    );
  }
}

export function canStartAnalysis(role: RoleId): boolean {
  return role === "reviewer" || role === "compliance_admin";
}
