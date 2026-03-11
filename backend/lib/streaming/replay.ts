import crypto from "crypto";
import { subscribeToEvents, type EventSubscription } from "@/lib/queue/consumer";
import type { AgentEvent } from "@/lib/queue/types";
import { getStreamChunks } from "./manager";

/**
 * Subscribe-first SSE replay helper.
 *
 * 1. Subscribe to RabbitMQ (buffer live events while replaying)
 * 2. Send current session status
 * 3. Replay cached Redis chunks
 * 4. If cache contains a terminal event (done/error), close after replay
 * 5. Flush buffered live events (dedup by seq), then switch to live mode
 */
export async function streamWithReplay(
  sessionId: string,
  sessionStatus: string,
  send: (event: string, data: unknown) => void,
  cleanup: () => void,
  signal: AbortSignal,
): Promise<EventSubscription> {
  let replaying = true;
  let highestSeq = 0;
  const liveBuffer: AgentEvent[] = [];

  // 1. Subscribe to RabbitMQ FIRST (buffer while replaying)
  const subscription = await subscribeToEvents(sessionId, (agentEvent) => {
    if (signal.aborted) return;

    if (replaying) {
      liveBuffer.push(agentEvent);
      return;
    }

    // Live mode: skip events already seen via cache replay
    if (typeof agentEvent.seq === "number" && agentEvent.seq <= highestSeq) {
      return;
    }

    send(agentEvent.event, agentEvent.data);
  });

  // 2. Send current session status
  send("status", { id: crypto.randomUUID(), status: sessionStatus });

  // 3. Replay cached chunks from Redis
  const chunks = await getStreamChunks(sessionId);
  let hasTerminal = false;

  for (const raw of chunks) {
    if (signal.aborted) break;

    try {
      const event: AgentEvent = JSON.parse(raw);
      if (typeof event.seq === "number" && event.seq > highestSeq) {
        highestSeq = event.seq;
      }
      send(event.event, event.data);

      if (event.event === "done" || event.event === "error") {
        hasTerminal = true;
      }
    } catch {
      // Skip unparseable chunks
    }
  }

  // 4. If agent already finished, close after replay
  if (hasTerminal) {
    replaying = false;
    cleanup();
    return subscription;
  }

  // 5. Flush buffered live events and switch to live mode
  replaying = false;

  for (const agentEvent of liveBuffer) {
    if (signal.aborted) break;

    if (typeof agentEvent.seq === "number" && agentEvent.seq <= highestSeq) {
      continue;
    }

    send(agentEvent.event, agentEvent.data);
  }

  return subscription;
}
