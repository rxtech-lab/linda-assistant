import { test, expect, type APIRequestContext } from "@playwright/test";
import { consumeSSE } from "./helpers/sse-client";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
  sendMessageResponseSchema,
} from "./helpers/schemas";

async function waitForStatus(
  request: APIRequestContext,
  sessionId: string,
  status: string,
  timeoutMs = 10000
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`/api/chat-sessions/${sessionId}`);
    const body = await res.json();
    if (body.status === status) return body;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Timeout: session ${sessionId} did not reach status "${status}"`
  );
}

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

test.describe("Stream Lifecycle", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Stream Lifecycle Assistant",
        email: "stream-lifecycle@example.com",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.id;
  });

  test("receives stream events after sending message, IDs match stored messages", async ({
    request,
    baseURL,
  }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Start SSE subscription BEFORE posting so we catch all events
    const eventsPromise = consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } }
    );
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message (triggers worker via RabbitMQ)
    const msgRes = await request.post(
      `/api/chat-sessions/${sessionId}/messages`,
      { data: { content: "Hello" } }
    );
    expect(msgRes.ok()).toBeTruthy();
    sendMessageResponseSchema.parse(await msgRes.json());

    // Await all events until "done"
    const events = await eventsPromise;

    // Collect text-delta events and their IDs
    const textEvents = events.filter((e) => e.event === "text-delta");
    expect(textEvents.length).toBeGreaterThan(0);

    // All text-delta events share a single step ID
    const stepIds = new Set(textEvents.map((e) => e.data.id));
    expect(stepIds.size).toBe(1);
    const streamStepId = [...stepIds][0];
    expect(typeof streamStepId).toBe("string");

    // Fetch stored messages
    const getRes = await request.get(`/api/chat-sessions/${sessionId}`);
    expect(getRes.ok()).toBeTruthy();
    const stored = await getRes.json();
    chatSessionResponseSchema.parse(stored);

    // Session has 2 messages: user + assistant
    expect(stored.messages.length).toBe(2);
    expect(stored.status).toBe("stopped");

    // User message has an ID
    const userMsg = stored.messages[0];
    expect(userMsg.role).toBe("user");
    expect(typeof userMsg.id).toBe("string");

    // Assistant message ID matches the stream step ID
    const assistantMsg = stored.messages[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.id).toBe(streamStepId);
  });

  test("no message replay after disconnect and reconnect", async ({
    request,
    baseURL,
  }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Turn 1: subscribe first, then send message
    const events1Promise = consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } }
    );
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "Hello" },
    });

    const events1 = await events1Promise;
    const turn1Ids = new Set(
      events1
        .filter((e) => e.event === "text-delta")
        .map((e) => e.data.id)
    );
    expect(turn1Ids.size).toBe(1);

    // Reconnect — should get only status event, no replay of turn 1
    const reconnectEvents = await consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      {
        headers: { authorization: "Bearer e2e-test-token" },
        stopOnEvent: "status",
        timeoutMs: 3000,
      }
    );
    const reconnectTypes = reconnectEvents.map((e) => e.event);
    expect(reconnectTypes).toContain("status");
    expect(reconnectTypes).not.toContain("text-delta");

    // Turn 2: subscribe first, then send message
    const events2Promise = consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } }
    );
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "Second" },
    });

    const events2 = await events2Promise;
    const turn2Ids = new Set(
      events2
        .filter((e) => e.event === "text-delta")
        .map((e) => e.data.id)
    );
    expect(turn2Ids.size).toBe(1);

    // Turn 2 IDs differ from turn 1
    const turn1Id = [...turn1Ids][0];
    const turn2Id = [...turn2Ids][0];
    expect(turn2Id).not.toBe(turn1Id);

    // DB has 4 messages, all unique IDs
    const getRes = await request.get(`/api/chat-sessions/${sessionId}`);
    const stored = await getRes.json();
    chatSessionResponseSchema.parse(stored);
    expect(stored.messages.length).toBe(4);

    const allIds = stored.messages.map((m: { id: string }) => m.id);
    expect(new Set(allIds).size).toBe(4);
  });

  test("GET historical messages then stream new ones without duplication", async ({
    request,
    baseURL,
  }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Send first message — do NOT connect to stream
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "Hello" },
    });

    // Poll GET until agent finishes
    const stored1 = await waitForStatus(request, sessionId, "stopped");
    chatSessionResponseSchema.parse(stored1);
    const historicalIds = stored1.messages.map((m: { id: string }) => m.id);
    expect(historicalIds.length).toBe(2); // user + assistant

    // Subscribe first, then send second message
    const eventsPromise = consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } }
    );
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "How are you?" },
    });

    const events = await eventsPromise;

    const newEventIds = new Set(
      events
        .filter((e) => e.event === "text-delta")
        .map((e) => e.data.id)
    );
    expect(newEventIds.size).toBe(1);

    // New stream IDs don't overlap with historical IDs
    for (const eventId of newEventIds) {
      expect(historicalIds).not.toContain(eventId);
    }

    // DB now has 4 messages, all unique IDs
    const stored2 = await waitForStatus(request, sessionId, "stopped");
    chatSessionResponseSchema.parse(stored2);
    expect(stored2.messages.length).toBe(4);

    const allIds = stored2.messages.map((m: { id: string }) => m.id);
    expect(new Set(allIds).size).toBe(4);
  });

  test("partial stream consumption with GET catch-up", async ({
    request,
    baseURL,
  }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe first, then send message
    const partialEventsPromise = consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      {
        headers: { authorization: "Bearer e2e-test-token" },
        stopOnEvent: "text-delta",
      }
    );
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "Hello" },
    });

    // Consume only until first text-delta, then disconnect
    const partialEvents = await partialEventsPromise;
    const gotTextDelta = partialEvents.some((e) => e.event === "text-delta");
    expect(gotTextDelta).toBe(true);

    // Agent completes in the worker despite our disconnect — poll until stopped
    const stored = await waitForStatus(request, sessionId, "stopped");
    chatSessionResponseSchema.parse(stored);

    // Session has 2 messages — agent ran to completion
    expect(stored.messages.length).toBe(2);
    expect(stored.messages[0].role).toBe("user");
    expect(stored.messages[1].role).toBe("assistant");

    // All messages have IDs
    for (const msg of stored.messages) {
      expect(typeof msg.id).toBe("string");
    }

    // Reconnect — only status event, no replay
    const reconnectEvents = await consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      {
        headers: { authorization: "Bearer e2e-test-token" },
        stopOnEvent: "status",
        timeoutMs: 3000,
      }
    );
    const reconnectTypes = reconnectEvents.map((e) => e.event);
    expect(reconnectTypes).toContain("status");
    expect(reconnectTypes).not.toContain("text-delta");
  });
});
