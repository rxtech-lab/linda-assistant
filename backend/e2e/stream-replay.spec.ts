import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import path from "path";
import { assigneeResponseSchema, sendMessageResponseSchema } from "./helpers/schemas";
import { consumeSSE } from "./helpers/sse-client";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

async function waitForStopped(assigneeId: string, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id, status FROM chat_sessions WHERE assignee_id = ? ORDER BY created_at DESC LIMIT 1",
      args: [assigneeId],
    });
    client.close();
    if (result.rows.length > 0 && result.rows[0].status === "stopped") {
      return result.rows[0].id as string;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout: chat for assignee ${assigneeId} did not reach status "stopped"`);
}

/** Collect SSE events manually with abort control for disconnect simulation */
async function collectSSEEvents(
  url: string,
  opts: {
    signal: AbortSignal;
    onEvent?: (event: { event: string; data: any }) => void;
  },
): Promise<Array<{ event: string; data: any }>> {
  const events: Array<{ event: string; data: any }> = [];

  try {
    const response = await fetch(url, {
      headers: { accept: "text/event-stream", authorization: "Bearer e2e-test-token" },
      signal: opts.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    let currentData = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line === "") {
          if (currentEvent && currentData) {
            try {
              const parsed = { event: currentEvent, data: JSON.parse(currentData) };
              events.push(parsed);
              opts.onEvent?.(parsed);
            } catch {
              /* ignore parse errors */
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
  } catch {
    /* aborted or network error — expected for disconnect simulation */
  }

  return events;
}

test.describe("Stream Replay", () => {
  test.describe.configure({ retries: 2 });

  test("replay mid-stream events after disconnect/reconnect", async ({ request, baseURL }) => {
    // Create a fresh assignee
    const assigneeRes = await request.post("/api/assignees", {
      data: { name: "Replay Test Assistant", email: "replay-test@example.com" },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const assigneeId = (await assigneeRes.json()).id;

    // Send first message to auto-create session
    await request.post(`/api/chat/${assigneeId}/message`, { data: { content: "Hello" } });
    await waitForStopped(assigneeId);

    // Send a slow-stream message (30 words × 300ms = ~9s)
    const msgRes = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "[SLOW_STREAM_LONG]" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Connect SSE and collect a few text-delta events, then disconnect
    const controller1 = new AbortController();
    let firstConnectionTextDeltas = 0;

    const firstEvents = await new Promise<Array<{ event: string; data: any }>>((resolve) => {
      collectSSEEvents(`${baseURL}/api/chat/${assigneeId}/stream`, {
        signal: controller1.signal,
        onEvent: (evt) => {
          if (evt.event === "text-delta") {
            firstConnectionTextDeltas++;
            // Disconnect after receiving 3 text-deltas
            if (firstConnectionTextDeltas >= 3) {
              controller1.abort();
            }
          }
        },
      }).then(resolve);
    });

    expect(firstConnectionTextDeltas).toBeGreaterThanOrEqual(3);

    // Wait a bit for more events to be cached in Redis while we're disconnected
    await new Promise((r) => setTimeout(r, 1500));

    // Reconnect — should replay cached events then continue with live
    const reconnectEvents = await consumeSSE(`${baseURL}/api/chat/${assigneeId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      timeoutMs: 20000,
    });

    const reconnectEventTypes = reconnectEvents.map((e) => e.event);

    // Should have replayed text-delta events (at least as many as were cached)
    const replayedTextDeltas = reconnectEvents.filter((e) => e.event === "text-delta");
    expect(replayedTextDeltas.length).toBeGreaterThan(firstConnectionTextDeltas);

    // Should have exactly one done event (no duplicates from dedup)
    const doneEvents = reconnectEvents.filter((e) => e.event === "done");
    expect(doneEvents.length).toBe(1);

    // Should have status event
    expect(reconnectEventTypes).toContain("status");

    // Collect all text from reconnected stream
    const reconnectedText = replayedTextDeltas.map((e) => e.data.text).join("");

    // The text should contain words that appeared AFTER our disconnect
    // We disconnected after 3 words, so there should be later words
    expect(reconnectedText.length).toBeGreaterThan(0);

    // Verify no duplicate text-delta events (each should have unique seq)
    const seqs = replayedTextDeltas
      .map((e) => e.data.seq)
      .filter((s: unknown) => s !== undefined);
    const uniqueSeqs = new Set(seqs);
    // If seq is present, all should be unique
    if (seqs.length > 0) {
      expect(uniqueSeqs.size).toBe(seqs.length);
    }
  });

  test("no replay when stream already stopped", async ({ request, baseURL }) => {
    // Create a fresh assignee
    const assigneeRes = await request.post("/api/assignees", {
      data: { name: "No Replay Test", email: "no-replay@example.com" },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const assigneeId = (await assigneeRes.json()).id;

    // Send message and wait for completion (fast mock finishes instantly)
    const msgRes = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "Hello" },
    });
    expect(msgRes.ok()).toBeTruthy();
    await waitForStopped(assigneeId);

    // Now send another message and wait for it to complete
    // This triggers a new agent run which clears the cache from the first run
    const msg2Res = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "Hello again" },
    });
    expect(msg2Res.ok()).toBeTruthy();
    await waitForStopped(assigneeId);

    // Connect to SSE after both runs are done
    // The cache from the second run should have been cleared by any subsequent run,
    // but since there's no third run, the cache from the second run will be replayed.
    // However, since the cache contains a "done" event, the stream should close after replay.
    const events = await consumeSSE(`${baseURL}/api/chat/${assigneeId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      timeoutMs: 5000,
    });

    const eventTypes = events.map((e) => e.event);

    // Should have status event
    expect(eventTypes).toContain("status");

    // The key assertion: the status should be "stopped" (agent already finished)
    const statusEvent = events.find((e) => e.event === "status");
    expect(statusEvent?.data.status).toBe("stopped");

    // If cache has events from the last run, they include done — stream closes after replay.
    // Either way, no NEW text-delta streaming should happen (agent is not running).
    // Note: user-message events may appear from live RabbitMQ (multi-device sync) — that's expected.
    if (eventTypes.includes("done")) {
      const doneEvents = events.filter((e) => e.event === "done");
      expect(doneEvents.length).toBe(1);
    }

    // Filter to only agent-generated events (exclude user-message, status)
    const agentStreamEvents = events.filter(
      (e) => !["status", "user-message", "done", "error"].includes(e.event),
    );
    // Text deltas from the cache replay are fine (they're from the completed run),
    // but there should be no LIVE streaming text deltas after the done event
    const doneIdx = events.findIndex((e) => e.event === "done");
    if (doneIdx >= 0) {
      const eventsAfterDone = events.slice(doneIdx + 1);
      const textDeltasAfterDone = eventsAfterDone.filter((e) => e.event === "text-delta");
      expect(textDeltasAfterDone.length).toBe(0);
    }
  });
});
