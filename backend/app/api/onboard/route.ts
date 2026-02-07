import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assignees } from "@/lib/db/schema";
import { eq, count } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { onboardResponseSchema } from "@/lib/schemas";

/**
 * @openapi
 * @operationId getOnboardStatus
 * @response onboardResponseSchema
 * @add 400:onboardResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const [result] = await db
    .select({ count: count() })
    .from(assignees)
    .where(eq(assignees.userId, auth.userId));

  if (result.count === 0) {
    return NextResponse.json(
      {
        assignee: { check: false, required: ["assignee:create"] },
        overall: false,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    assignee: { check: true },
    overall: true,
  });
}
