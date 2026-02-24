import { authenticate } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { errorJson, successJson } from "@/lib/utils/response";
import { isStreamActive, setStopRequested } from "@/lib/streaming/manager";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

/**
 * Stop an in-progress agent stream for a chat session.
 *
 * Sets a Redis flag that the worker polls; when detected the worker
 * aborts the running agent via its AbortController. Returns immediately
 * with `{ stopped: true }`.
 *
 * @openapi
 * @operationId stopStream
 * @pathParams idParamSchema
 * @response stoppedResponseSchema
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  // Verify session belongs to user
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId)));

  if (!session) return errorJson("Chat session not found", 404);

  const active = await isStreamActive(id);
  if (!active) return successJson({ stopped: true });

  await setStopRequested(id);
  return successJson({ stopped: true });
}
