import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { publishStopCommand } from "@/lib/queue/producer";
import { errorJson, successJson } from "@/lib/utils/response";

/**
 * Stop an in-progress agent stream for a chat session.
 *
 * Publishes a stop command to the RabbitMQ agent-commands exchange;
 * the worker receives it and aborts the running agent via its
 * AbortController. Returns immediately with `{ stopped: true }`.
 *
 * If no worker is actively processing the session, the command is
 * harmlessly discarded by RabbitMQ (no subscriber on the exclusive queue).
 *
 * @openapi
 * @operationId stopStream
 * @pathParams idParamSchema
 * @response stoppedResponseSchema
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  // Verify session belongs to user
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId)));

  if (!session) return errorJson("Chat session not found", 404);

  await publishStopCommand(id);
  return successJson({ stopped: true });
}
