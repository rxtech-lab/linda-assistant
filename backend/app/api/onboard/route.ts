import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assignees, devices } from "@/lib/db/schema";
import { and, eq, count } from "drizzle-orm";
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

  const deviceToken = request.nextUrl.searchParams.get("deviceToken");
  console.log(
    "Checking onboard status for user:",
    auth.userId,
    "with deviceToken:",
    deviceToken,
  );

  const [assigneeResult, deviceResult] = await Promise.all([
    db
      .select({ count: count() })
      .from(assignees)
      .where(eq(assignees.userId, auth.userId)),
    deviceToken
      ? db
          .select({ count: count() })
          .from(devices)
          .where(
            and(
              eq(devices.userId, auth.userId),
              eq(devices.deviceToken, deviceToken),
            ),
          )
      : Promise.resolve([{ count: 0 }]),
  ]);

  const hasAssignee = assigneeResult[0].count > 0;
  const hasDevice = deviceResult[0].count > 0;

  if (!hasAssignee) {
    return NextResponse.json(
      {
        assignee: { check: false, required: ["assignee:create"] },
        device: { check: hasDevice },
        overall: false,
      },
      { status: 400 },
    );
  }

  console.log("Onboard status:", {
    assignee: { check: hasAssignee },
    device: { check: hasDevice },
  });
  return NextResponse.json({
    assignee: { check: true },
    device: { check: hasDevice },
    overall: true,
  });
}
