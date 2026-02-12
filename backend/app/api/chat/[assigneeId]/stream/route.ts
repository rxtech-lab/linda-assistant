import crypto from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees, chatSessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { assigneeIdParamSchema, streamEventSchema } from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";
import { createSSEStream, sseResponse } from "@/lib/streaming/sse";
import { subscribeToEvents } from "@/lib/queue/consumer";

/**
 * SSE stream for real-time agent events on an assignee's persistent chat.
 *
 * Returns 404 if no session exists yet for this assignee+user pair
 * (send a message first via `POST /api/chat/:assigneeId/message`).
 *
 * The stream stays open indefinitely — the client connects once and receives
 * live events for all agent runs in this session.
 *
 * Events: status, text-delta, tool-call, tool-result, confirmation_required, error, done
 *
 * @openapi
 * @operationId streamChat
 * @pathParams assigneeIdParamSchema
 * @response streamEventSchema
 * @responseDescription SSE stream of agent events
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

  const { stream, send, ping, close } = createSSEStream();

  // Start streaming in the background
  (async () => {
    let subscription: Awaited<ReturnType<typeof subscribeToEvents>> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (heartbeat) clearInterval(heartbeat);
      subscription?.close();
      close();
    };

    try {
      // Handle client disconnect
      request.signal.addEventListener("abort", cleanup);

      // Keep connection alive with periodic pings (every 30s)
      heartbeat = setInterval(ping, 30_000);

      // Subscribe to live events from the worker
      console.log(
        `[Stream] Subscribing to events for session=${session.id} (assignee=${assigneeId})`,
      );
      subscription = await subscribeToEvents(session.id, (agentEvent) => {
        console.log(`[Stream] Live event: ${agentEvent.event} session=${session.id}`);
        send(agentEvent.event, agentEvent.data);
      });

      // Send current session status
      send("status", { id: crypto.randomUUID(), status: session.status });
    } catch (error) {
      if (!request.signal.aborted) {
        send("error", { id: crypto.randomUUID(), error: String(error) });
      }
      cleanup();
    }
  })();

  return sseResponse(stream);
}
