import { NextRequest, NextResponse } from "next/server";

export interface AuthContext {
  userId: string;
}

export async function authenticate(request: NextRequest): Promise<AuthContext | NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing or invalid authorization header" }, { status: 401 });
  }

  if (process.env.IS_E2E) {
    const testUserId = request.headers.get("x-test-user-id");
    return { userId: testUserId || "e2e-test-user" };
  }

  const token = authHeader.slice(7);

  try {
    const response = await fetch("https://auth.rxlab.app/api/oauth/userinfo", {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const userInfo = await response.json();
    const userId = userInfo.sub;

    if (!userId) {
      return NextResponse.json({ error: "Token missing user identifier" }, { status: 401 });
    }

    return { userId };
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
}
