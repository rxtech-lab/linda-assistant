import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assignees, chatSessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { assigneeIdParamSchema, chatMessagesResponseSchema } from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";

/**
 * Get paginated messages from an assignee's persistent chat.
 *
 * Returns the last `limit` messages (default 100, max 100) in chronological order.
 * Use the `before` query param with a message ID to load older messages
 * for infinite scroll.
 *
 * @openapi
 * @operationId getChatMessages
 * @pathParams assigneeIdParamSchema
 * @response chatMessagesResponseSchema
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
    .select()
    .from(assignees)
    .where(and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)));

  if (!assignee) return errorJson("Assignee not found", 404);

  // Find existing session
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.assigneeId, assigneeId), eq(chatSessions.userId, auth.userId)))
    .limit(1);

  if (!session) return errorJson("No chat session exists for this assignee", 404);

  const url = new URL(request.url);
  const allMessages = (session.messages as Array<{ id?: string }>) || [];
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 100);
  const before = url.searchParams.get("before");

  let endIndex = allMessages.length;
  if (before) {
    const idx = allMessages.findIndex((m) => m.id === before);
    if (idx === -1) return errorJson("Cursor not found", 400);
    endIndex = idx;
  }

  const startIndex = Math.max(0, endIndex - limit);
  const slice = allMessages.slice(startIndex, endIndex);
  const nextCursor = startIndex > 0 ? (allMessages[startIndex]?.id ?? null) : null;

  return NextResponse.json({ messages: slice, nextCursor });
}
