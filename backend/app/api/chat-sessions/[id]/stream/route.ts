import crypto from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { idParamSchema } from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";
import { createSSEStream, sseResponse } from "@/lib/streaming/sse";
import { streamWithReplay } from "@/lib/streaming/replay";

/**
 * SSE stream for real-time agent events.
 *
 * The stream stays open indefinitely — the client connects once and receives
 * live events for all agent runs in this session. On reconnection, cached
 * events are replayed from Redis before switching to live mode.
 *
 * Flow:
 * 1. Subscribes to the RabbitMQ `agent-events` exchange (routing key: session.<id>)
 * 2. Replays cached chunks from Redis (with deduplication)
 * 3. Switches to live mode — forwarding events from the RabbitMQ subscription as SSE
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
    let subscription: Awaited<ReturnType<typeof streamWithReplay>> | null = null;
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

      // Subscribe, replay cached events, then switch to live mode
      console.log(`[Stream] Subscribing to events for session=${id}`);
      subscription = await streamWithReplay(id, session.status ?? "idle", send, cleanup, request.signal);
    } catch (error) {
      if (!request.signal.aborted) {
        send("error", { id: crypto.randomUUID(), error: String(error) });
      }
      cleanup();
    }
  })();

  return sseResponse(stream);
}
