import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks, chatSessions, briefings } from "@/lib/db/schema";
import { eq, and, sql, like, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { briefingSummarySchema, idParamSchema } from "@/lib/schemas";
import { errorJson, paginatedJson } from "@/lib/utils/response";
import { parsePagination } from "@/lib/utils/pagination";
import { withShareUrl } from "@/lib/utils/briefing";
import { z } from "zod";

const taskBriefingsResponseSchema = z.object({
  data: z.array(briefingSummarySchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

/**
 * @openapi
 * @operationId listTaskBriefings
 * @pathParams idParamSchema
 * @response taskBriefingsResponseSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search") || "";

  // Verify task belongs to user
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)));

  if (!task) return errorJson("Task not found", 404);

  const baseWhere = search
    ? and(eq(chatSessions.taskId, id), like(briefings.title, `%${search}%`))
    : eq(chatSessions.taskId, id);

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: briefings.id,
        title: briefings.title,
        imageUrl: briefings.imageUrl,
        podcastUrl: briefings.podcastUrl,
        podcastStatus: briefings.podcastStatus,
        podcastError: briefings.podcastError,
        podcastAttempts: briefings.podcastAttempts,
        isPublic: briefings.isPublic,
        chatSessionId: briefings.chatSessionId,
        assigneeId: briefings.assigneeId,
        createdAt: briefings.createdAt,
        updatedAt: briefings.updatedAt,
      })
      .from(briefings)
      .innerJoin(chatSessions, eq(briefings.chatSessionId, chatSessions.id))
      .where(baseWhere)
      .orderBy(desc(briefings.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(briefings)
      .innerJoin(chatSessions, eq(briefings.chatSessionId, chatSessions.id))
      .where(baseWhere),
  ]);

  return paginatedJson(items.map(withShareUrl), countResult[0].count, limit, offset);
}
