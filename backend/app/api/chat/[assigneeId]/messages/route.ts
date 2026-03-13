import { authenticate } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { deleteSessionMessages, getPagedMessages } from "@/lib/db/messages";
import { assignees, chatSessions, confirmations } from "@/lib/db/schema";
import { errorJson, successJson } from "@/lib/utils/response";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

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
    .select({ id: assignees.id })
    .from(assignees)
    .where(
      and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)),
    );

  if (!assignee) return errorJson("Assignee not found", 404);

  // Find existing session
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.assigneeId, assigneeId),
        eq(chatSessions.userId, auth.userId),
      ),
    )
    .limit(1);

  if (!session)
    return errorJson("No chat session exists for this assignee", 404);

  const url = new URL(request.url);
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "100", 10) || 100,
    100,
  );
  const before = url.searchParams.get("before") || undefined;

  try {
    const result = await getPagedMessages(session.id, limit, before);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "Cursor not found") {
      return errorJson("Cursor not found", 400);
    }
    throw e;
  }
}

/**
 * Clear all messages from an assignee's persistent chat.
 *
 * Deletes all messages from the messages table for this assignee's chat session.
 * The session itself is preserved.
 *
 * @openapi
 * @operationId clearChatMessages
 * @pathParams assigneeIdParamSchema
 * @response deletedResponseSchema
 */
export async function DELETE(
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
    .where(
      and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)),
    );

  if (!assignee) return errorJson("Assignee not found", 404);

  // Find existing session
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.assigneeId, assigneeId),
        eq(chatSessions.userId, auth.userId),
      ),
    )
    .limit(1);

  if (!session)
    return errorJson("No chat session exists for this assignee", 404);

  await deleteSessionMessages(session.id);
  await db
    .delete(confirmations)
    .where(eq(confirmations.chatSessionId, session.id));
  return successJson({ deleted: true });
}
