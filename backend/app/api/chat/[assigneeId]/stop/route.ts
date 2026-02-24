import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { assignees, chatSessions } from "@/lib/db/schema";
import { isStreamActive, setStopRequested } from "@/lib/streaming/manager";
import { errorJson, successJson } from "@/lib/utils/response";

/**
 * Stop an in-progress agent stream for an assignee's persistent chat.
 *
 * Looks up the persistent session for the assignee+user pair and sets
 * a Redis flag that the worker polls; when detected the worker aborts
 * the running agent via its AbortController.
 *
 * @openapi
 * @operationId stopChatStream
 * @pathParams assigneeIdParamSchema
 * @response stoppedResponseSchema
 */
export async function POST(
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

  // Find the persistent session for this assignee+user pair
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.assigneeId, assigneeId), eq(chatSessions.userId, auth.userId)))
    .limit(1);

  if (!session) return successJson({ stopped: true });

  const active = await isStreamActive(session.id);
  if (!active) return successJson({ stopped: true });

  await setStopRequested(session.id);
  return successJson({ stopped: true });
}
