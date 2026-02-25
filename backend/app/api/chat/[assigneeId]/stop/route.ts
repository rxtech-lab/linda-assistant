import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { assignees, chatSessions } from "@/lib/db/schema";
import { publishStopCommand } from "@/lib/queue/producer";
import { errorJson, successJson } from "@/lib/utils/response";

/**
 * Stop an in-progress agent stream for an assignee's persistent chat.
 *
 * Publishes a stop command to the RabbitMQ agent-commands exchange;
 * the worker receives it and aborts the running agent via its
 * AbortController.
 *
 * If no worker is actively processing the session, the command is
 * harmlessly discarded by RabbitMQ (no subscriber on the exclusive queue).
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

  await publishStopCommand(session.id);
  return successJson({ stopped: true });
}
