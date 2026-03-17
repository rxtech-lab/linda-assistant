import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { listBriefingResponseSchema } from "@/lib/schemas";
import { parsePagination } from "@/lib/utils/pagination";
import { paginatedJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId listBriefings
 * @response listBriefingResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { limit, offset } = parsePagination(request.nextUrl.searchParams);

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(briefings)
      .where(eq(briefings.userId, auth.userId))
      .orderBy(desc(briefings.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(briefings)
      .where(eq(briefings.userId, auth.userId)),
  ]);

  // Group by date (YYYY-MM-DD from createdAt)
  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    const date = item.createdAt ? item.createdAt.split(" ")[0] : "unknown";
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(item);
  }

  // Convert to sorted array of { date, briefings }
  const sections = Object.entries(grouped)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dateBriefings]) => ({ date, briefings: dateBriefings }));

  return paginatedJson(sections, countResult[0].count, limit, offset);
}
