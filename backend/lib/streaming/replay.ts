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

  console.log(`[Replay] session=${sessionId} status=${sessionStatus} starting`);

  // 1. Subscribe to RabbitMQ FIRST (buffer while replaying)
  const subscription = await subscribeToEvents(sessionId, (agentEvent) => {
    if (signal.aborted) return;

    if (replaying) {
      console.log(
        `[Replay] session=${sessionId} buffering live event=${agentEvent.event} seq=${agentEvent.seq}`,
      );
      liveBuffer.push(agentEvent);
      return;
    }

    // Live mode: skip events already seen via cache replay
    if (typeof agentEvent.seq === "number" && agentEvent.seq <= highestSeq) {
      console.log(
        `[Replay] session=${sessionId} dedup seq=${agentEvent.seq} <= highestSeq=${highestSeq}`,
      );
      return;
    }

    console.log(
      `[Replay] session=${sessionId} live event=${agentEvent.event} seq=${agentEvent.seq}`,
    );
    send(agentEvent.event, agentEvent.data);
  });

  // 2. Send current session status
  send("status", { id: crypto.randomUUID(), status: sessionStatus });

  // 3. Replay cached chunks from Redis
  const chunks = await getStreamChunks(sessionId);
  let hasTerminal = false;

  console.log(
    `[Replay] session=${sessionId} chunks=${chunks.length} firstType=${chunks.length > 0 ? typeof chunks[0] : "n/a"}`,
  );

  for (const raw of chunks) {
    if (signal.aborted) break;

    try {
      // @upstash/redis auto-deserializes JSON values, so lrange may return
      // already-parsed objects instead of strings.
      const event: AgentEvent =
        typeof raw === "string" ? JSON.parse(raw) : (raw as AgentEvent);
      if (typeof event.seq === "number" && event.seq > highestSeq) {
        highestSeq = event.seq;
      }
      send(event.event, event.data);

      if (event.event === "done" || event.event === "error") {
        hasTerminal = true;
      }
    } catch (err) {
      console.warn(
        `[Replay] session=${sessionId} skipped chunk: typeof=${typeof raw} error=${err}`,
      );
    }
  }

  console.log(
    `[Replay] session=${sessionId} replayed=${chunks.length} hasTerminal=${hasTerminal} highestSeq=${highestSeq}`,
  );

  // 4. If agent already finished, close after replay
  if (hasTerminal) {
    console.log(
      `[Replay] session=${sessionId} terminal event found, closing after replay`,
    );
    replaying = false;
    cleanup();
    return subscription;
  }

  // 5. Flush buffered live events and switch to live mode
  replaying = false;
  console.log(
    `[Replay] session=${sessionId} switching to live mode, buffered=${liveBuffer.length}`,
  );

  for (const agentEvent of liveBuffer) {
    if (signal.aborted) break;

    if (typeof agentEvent.seq === "number" && agentEvent.seq <= highestSeq) {
      continue;
    }

    send(agentEvent.event, agentEvent.data);
  }

  return subscription;
}
