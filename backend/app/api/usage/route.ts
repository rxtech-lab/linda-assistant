import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { usage, assignees } from "@/lib/db/schema";
import { eq, sql, and, gte, isNotNull } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { successJson, errorJson } from "@/lib/utils/response";
import { z } from "zod";
import { usageResponseSchema } from "@/lib/schemas";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  tzOffset: z.coerce.number().min(-12).max(14).default(0),
});

/**
 * @openapi
 * @operationId getUsage
 * @response usageResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const { days, tzOffset } = parsed.data;
  const hourly = days === 1;

  // SQLite modifier for timezone offset, e.g. "+8 hours" or "-5 hours"
  const tzMod = `${tzOffset >= 0 ? "+" : ""}${tzOffset} hours`;

  // Compute "since" in the user's local time, then convert to UTC for filtering
  // For 24h: start of yesterday in user's local time
  // For multi-day: N days ago in user's local date
  const now = new Date();
  const localNow = new Date(now.getTime() + tzOffset * 3600_000);
  const localSince = new Date(localNow);
  localSince.setDate(localSince.getDate() - days);
  localSince.setHours(0, 0, 0, 0);
  // Convert back to UTC
  const sinceUtc = new Date(localSince.getTime() - tzOffset * 3600_000);
  const sinceUtcStr = sinceUtc.toISOString().slice(0, 19).replace("T", " ");

  // For 24h view, group by hour in local time; otherwise group by date in local time
  const timeExpr = hourly
    ? sql`strftime('%Y-%m-%dT%H:00', ${usage.createdAt}, ${tzMod})`
    : sql`date(${usage.createdAt}, ${tzMod})`;
  const sinceExpr = gte(usage.createdAt, sinceUtcStr);

  const [daily, byAssignee, totalResult] = await Promise.all([
    // Daily (or hourly) aggregation
    db
      .select({
        date: sql<string>`${timeExpr}`.as("date"),
        inputTokens: sql<number>`coalesce(sum(${usage.inputTokens}), 0)`.as("inputTokens"),
        outputTokens: sql<number>`coalesce(sum(${usage.outputTokens}), 0)`.as("outputTokens"),
        costUsd: sql<number>`coalesce(sum(${usage.costUsd}), 0)`.as("costUsd"),
      })
      .from(usage)
      .where(and(eq(usage.userId, auth.userId), sinceExpr))
      .groupBy(timeExpr)
      .orderBy(timeExpr),

    // By assignee aggregation
    db
      .select({
        assigneeId: usage.assigneeId,
        assigneeName: sql<string>`coalesce(${assignees.name}, 'Unknown')`.as("assigneeName"),
        inputTokens: sql<number>`coalesce(sum(${usage.inputTokens}), 0)`.as("inputTokens"),
        outputTokens: sql<number>`coalesce(sum(${usage.outputTokens}), 0)`.as("outputTokens"),
        costUsd: sql<number>`coalesce(sum(${usage.costUsd}), 0)`.as("costUsd"),
      })
      .from(usage)
      .leftJoin(assignees, eq(usage.assigneeId, assignees.id))
      .where(and(eq(usage.userId, auth.userId), sinceExpr, isNotNull(usage.assigneeId)))
      .groupBy(usage.assigneeId),

    // Total
    db
      .select({
        inputTokens: sql<number>`coalesce(sum(${usage.inputTokens}), 0)`.as("inputTokens"),
        outputTokens: sql<number>`coalesce(sum(${usage.outputTokens}), 0)`.as("outputTokens"),
        costUsd: sql<number>`coalesce(sum(${usage.costUsd}), 0)`.as("costUsd"),
      })
      .from(usage)
      .where(and(eq(usage.userId, auth.userId), sinceExpr)),
  ]);

  const total = totalResult[0] ?? {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };

  return successJson({
    daily,
    byAssignee: byAssignee
      .filter((row) => row.inputTokens > 0 || row.outputTokens > 0)
      .map((row) => ({
        ...row,
        assigneeId: row.assigneeId!,
      })),
    total,
  });
}
