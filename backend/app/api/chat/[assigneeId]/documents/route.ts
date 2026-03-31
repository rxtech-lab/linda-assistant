import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees, chatSessions, documents } from "@/lib/db/schema";
import { eq, and, desc, like, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { assigneeIdParamSchema, selectDocumentSchema } from "@/lib/schemas";
import { successJson, errorJson, paginatedJson } from "@/lib/utils/response";
import { parsePagination } from "@/lib/utils/pagination";
import { z } from "zod";

const listResponseSchema = z.object({
  data: z.array(selectDocumentSchema),
});

/**
 * List documents from an assignee's persistent chat session.
 *
 * @openapi
 * @operationId listChatDocuments
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

  // Verify assignee belongs to user
  const [assignee] = await db
    .select({ id: assignees.id })
    .from(assignees)
    .where(and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)));

  if (!assignee) return errorJson("Assignee not found", 404);

  // Find existing session
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
        eq(documents.userId, auth.userId),
        eq(documents.chatSessionId, session.id),
        like(documents.title, `%${search}%`),
      )
    : and(eq(documents.userId, auth.userId), eq(documents.chatSessionId, session.id));

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(documents)
      .where(baseWhere)
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(documents).where(baseWhere),
  ]);

  return paginatedJson(items, countResult[0].count, limit, offset);
}
