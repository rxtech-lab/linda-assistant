import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { taskHistory, tasks } from "@/lib/db/schema";
import { eq, and, ne, sql, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { listHistoryResponseSchema } from "@/lib/schemas";
import { parsePagination } from "@/lib/utils/pagination";
import { paginatedJson } from "@/lib/utils/response";
import { searchHistoryByVector } from "@/lib/ai/history";

/**
 * @openapi
 * @operationId listHistory
 * @response listHistoryResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const assigneeId = request.nextUrl.searchParams.get("assigneeId");
  const search = request.nextUrl.searchParams.get("search");

  // Vector search path
  if (search) {
    const results = await searchHistoryByVector(search, auth.userId, assigneeId, limit);
    return paginatedJson(results, results.length, limit, offset);
  }

  // Standard paginated list (exclude pending entries)
  const baseWhere = assigneeId
    ? and(
        eq(taskHistory.userId, auth.userId),
        eq(taskHistory.assigneeId, assigneeId),
        ne(taskHistory.status, "pending"),
      )
    : and(eq(taskHistory.userId, auth.userId), ne(taskHistory.status, "pending"));

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: taskHistory.id,
        taskId: taskHistory.taskId,
        chatSessionId: taskHistory.chatSessionId,
        assigneeId: taskHistory.assigneeId,
        summary: taskHistory.summary,
        toolCalls: taskHistory.toolCalls,
        status: taskHistory.status,
        source: taskHistory.source,
        durationSecs: taskHistory.durationSecs,
        createdAt: taskHistory.createdAt,
        taskTitle: tasks.title,
      })
      .from(taskHistory)
      .innerJoin(tasks, eq(taskHistory.taskId, tasks.id))
      .where(baseWhere)
      .orderBy(desc(taskHistory.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(taskHistory).where(baseWhere),
  ]);

  return paginatedJson(items, countResult[0].count, limit, offset);
}
