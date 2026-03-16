import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { insertChatSessionSchema, selectChatSessionSchema } from "@/lib/schemas";
import { parsePagination } from "@/lib/utils/pagination";
import { successJson, errorJson, paginatedJson } from "@/lib/utils/response";
import { z } from "zod";

const listResponseSchema = z.object({
  data: z.array(selectChatSessionSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

/**
 * @openapi
 * @operationId listChatSessions
 * @response listResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { limit, offset } = parsePagination(request.nextUrl.searchParams);

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        taskId: chatSessions.taskId,
        assigneeId: chatSessions.assigneeId,
        title: chatSessions.title,
        status: chatSessions.status,
        timezone: chatSessions.timezone,
        createdAt: chatSessions.createdAt,
        updatedAt: chatSessions.updatedAt,
      })
      .from(chatSessions)
      .where(eq(chatSessions.userId, auth.userId))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(chatSessions)
      .where(eq(chatSessions.userId, auth.userId)),
  ]);

  return paginatedJson(items, countResult[0].count, limit, offset);
}

/**
 * @openapi
 * @operationId createChatSession
 * @body insertChatSessionSchema
 * @response 201:selectChatSessionSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = insertChatSessionSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [created] = await db
    .insert(chatSessions)
    .values({
      ...parsed.data,
      userId: auth.userId,
    })
    .returning();

  return successJson(created, 201);
}
