import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees, chatSessions, slideDecks, slidePages } from "@/lib/db/schema";
import { eq, and, desc, sql, inArray, like } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { paginatedJson, errorJson } from "@/lib/utils/response";
import { parsePagination } from "@/lib/utils/pagination";

/**
 * List slide decks from an assignee's persistent chat session.
 *
 * @openapi
 * @operationId listChatSlideDecks
 * @pathParams assigneeIdParamSchema
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

  // Find all sessions for this assignee
  const sessions = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.assigneeId, assigneeId), eq(chatSessions.userId, auth.userId)));

  if (sessions.length === 0) return paginatedJson([], 0, 20, 0);

  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");

  const sessionIds = sessions.map((s) => s.id);
  const baseWhere = and(
    eq(slideDecks.userId, auth.userId),
    inArray(slideDecks.chatSessionId, sessionIds),
    search ? like(slideDecks.title, `%${search}%`) : undefined,
  );

  const results = await db
    .select({
      id: slideDecks.id,
      title: slideDecks.title,
      createdAt: slideDecks.createdAt,
      updatedAt: slideDecks.updatedAt,
      pageCount: sql<number>`(select count(*) from slide_pages where deck_id = slide_decks.id)`,
      thumbnailUrl: sql<
        string | null
      >`(select thumbnail_url from slide_pages where deck_id = slide_decks.id order by page_number asc limit 1)`,
      total: sql<number>`count(*) over()`,
    })
    .from(slideDecks)
    .where(baseWhere)
    .orderBy(desc(slideDecks.createdAt))
    .limit(limit)
    .offset(offset);

  const total = results.length > 0 ? results[0].total : 0;
  const decks = results.map(({ total: _, ...rest }) => rest);
  return paginatedJson(decks, total, limit, offset);
}
