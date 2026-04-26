import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees, audios, chatSessions } from "@/lib/db/schema";
import { eq, and, desc, like, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { assigneeIdParamSchema, selectAudioSchema } from "@/lib/schemas";
import { errorJson, paginatedJson } from "@/lib/utils/response";
import { parsePagination } from "@/lib/utils/pagination";
import { z } from "zod";

const listResponseSchema = z.object({
  data: z.array(selectAudioSchema),
});

/**
 * List audios from an assignee's persistent chat session.
 *
 * @openapi
 * @operationId listChatAudios
 * @pathParams assigneeIdParamSchema
 * @response listResponseSchema
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assigneeId: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { assigneeId } = await params;

  const [assignee] = await db
    .select({ id: assignees.id })
    .from(assignees)
    .where(and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)));

  if (!assignee) return errorJson("Assignee not found", 404);

  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.assigneeId, assigneeId), eq(chatSessions.userId, auth.userId)))
    .limit(1);

  if (!session) return paginatedJson([], 0, 20, 0);

  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");

  const baseWhere = search
    ? and(
        eq(audios.userId, auth.userId),
        eq(audios.chatSessionId, session.id),
        like(audios.title, `%${search}%`),
      )
    : and(eq(audios.userId, auth.userId), eq(audios.chatSessionId, session.id));

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(audios)
      .where(baseWhere)
      .orderBy(desc(audios.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(audios).where(baseWhere),
  ]);

  return paginatedJson(items, countResult[0].count, limit, offset);
}
