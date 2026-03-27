import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks, chatSessions, documents } from "@/lib/db/schema";
import { eq, and, sql, like, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { documentSummarySchema, idParamSchema } from "@/lib/schemas";
import { errorJson, paginatedJson } from "@/lib/utils/response";
import { parsePagination } from "@/lib/utils/pagination";
import { z } from "zod";

const taskDocumentsResponseSchema = z.object({
  data: z.array(documentSummarySchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

/**
 * @openapi
 * @operationId listTaskDocuments
 * @pathParams idParamSchema
 * @response taskDocumentsResponseSchema
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
    ? and(eq(chatSessions.taskId, id), like(documents.title, `%${search}%`))
    : eq(chatSessions.taskId, id);

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        format: documents.format,
        chatSessionId: documents.chatSessionId,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .innerJoin(chatSessions, eq(documents.chatSessionId, chatSessions.id))
      .where(baseWhere)
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .innerJoin(chatSessions, eq(documents.chatSessionId, chatSessions.id))
      .where(baseWhere),
  ]);

  return paginatedJson(items, countResult[0].count, limit, offset);
}
