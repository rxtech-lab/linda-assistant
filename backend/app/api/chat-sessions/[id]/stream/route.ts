import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson } from "@/lib/utils/response";
import { createSSEStream, sseResponse } from "@/lib/streaming/sse";
import {
  getStreamChunks,
  isStreamActive,
  consumeAgentTrigger,
} from "@/lib/streaming/manager";
import { runAgent } from "@/lib/ai/agent";

/**
 * @openapi
 * @response 200 - SSE stream of agent events
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  // Verify session belongs to user
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId))
    );

  if (!session) return errorJson("Chat session not found", 404);

  const { stream, send, close } = createSSEStream();
  const abortController = new AbortController();

  // Handle client disconnect
  request.signal.addEventListener("abort", () => {
    abortController.abort();
    close();
  });

  // Start streaming in the background
  (async () => {
    try {
      // Replay cached chunks for reconnection
      const cachedChunks = await getStreamChunks(id);
      for (const chunk of cachedChunks) {
        try {
          const parsed = JSON.parse(chunk);
          send(parsed.type, parsed);
        } catch {
          send("chunk", { raw: chunk });
        }
      }

      // Check if agent is already running
      const active = await isStreamActive(id);
      if (active) {
        send("status", { status: "already_running" });
        // Wait and poll for updates
        await pollForUpdates(id, send, close, abortController.signal);
        return;
      }

      // Check if there's a trigger to start the agent
      const triggered = await consumeAgentTrigger(id);
      if (
        triggered ||
        session.status === "starting" ||
        session.status === "in_progress"
      ) {
        send("status", { status: "starting" });

        await runAgent({
          sessionId: id,
          userId: auth.userId,
          onEvent: (event, data) => {
            send(event, data);
          },
          signal: abortController.signal,
        });
      } else {
        send("status", { status: session.status });
      }

      send("done", {});
    } catch (error) {
      if (!abortController.signal.aborted) {
        send("error", { error: String(error) });
      }
    } finally {
      close();
    }
  })();

  return sseResponse(stream);
}

async function pollForUpdates(
  sessionId: string,
  send: (event: string, data: unknown) => void,
  close: () => void,
  signal: AbortSignal
) {
  const maxPolls = 120; // 2 minutes at 1s intervals
  for (let i = 0; i < maxPolls; i++) {
    if (signal.aborted) return;

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const active = await isStreamActive(sessionId);
    if (!active) {
      // Agent finished - send final status
      const [session] = await db
        .select({ status: chatSessions.status })
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId));

      send("status", { status: session?.status || "stopped" });
      return;
    }

    // Replay new chunks
    const chunks = await getStreamChunks(sessionId);
    for (const chunk of chunks) {
      try {
        const parsed = JSON.parse(chunk);
        send(parsed.type, parsed);
      } catch {
        send("chunk", { raw: chunk });
      }
    }
  }
}
