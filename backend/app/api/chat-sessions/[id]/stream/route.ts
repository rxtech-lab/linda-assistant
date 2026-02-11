import crypto from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { idParamSchema } from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";
import { createSSEStream, sseResponse } from "@/lib/streaming/sse";
import { subscribeToEvents } from "@/lib/queue/consumer";

/**
 * SSE stream for real-time agent events.
 *
 * The stream stays open indefinitely — the client connects once and receives
 * live events for all agent runs in this session. Only closes when the client
 * disconnects. No replay — the client fetches existing messages via
 * `GET /api/chat-sessions/[id]` before connecting.
 *
 * Flow:
 * 1. Subscribes to the RabbitMQ `agent-events` exchange (routing key: session.<id>)
 * 2. Sends current session status
 * 3. Forwards live agent events as they arrive from the worker
 *
 * Events: status, text-delta, tool-call, tool-result, confirmation_required, error, done
 *
 * @openapi
 * @operationId streamChatSession
 * @pathParams idParamSchema
 * @response streamEventSchema
 * @responseDescription SSE stream of agent events
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  // Verify session belongs to user
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId)));

  if (!session) return errorJson("Chat session not found", 404);

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
      console.log(`[Stream] Subscribing to events for session=${id}`);
      subscription = await subscribeToEvents(id, (agentEvent) => {
        console.log(`[Stream] Live event: ${agentEvent.event} session=${id}`);
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
