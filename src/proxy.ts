import { NextResponse, type NextRequest } from "next/server";
import { InvalidAuthTokenError, verifyJwtSession } from "@/server/auth/jwt-session";

function unauthorized(message: string) {
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message } }, { status: 401 });
}

export async function proxy(request: NextRequest) {
  if (process.env.FINPROOF_AUTH_MODE !== "jwt") {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization");
  const [scheme, token] = authorization?.split(/\s+/, 2) ?? [];

  if (scheme !== "Bearer" || !token) {
    return unauthorized("Bearer token is required");
  }

  try {
    await verifyJwtSession(token);

    return NextResponse.next();
  } catch (error) {
    return unauthorized(
      error instanceof InvalidAuthTokenError ? error.message : "Invalid authentication token"
    );
  }
}

export const config = {
  matcher: ["/api/v1/:path*"]
};
