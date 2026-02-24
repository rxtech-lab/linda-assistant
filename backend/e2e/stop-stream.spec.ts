import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import path from "path";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
  errorResponseSchema,
  stopStreamResponseSchema,
} from "./helpers/schemas";
import { consumeSSE } from "./helpers/sse-client";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");
const user2Headers = { "x-test-user-id": "e2e-user-2" };

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

async function waitForStopped(sessionId: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT status FROM chat_sessions WHERE id = ?",
      args: [sessionId],
    });
    client.close();
    if (result.rows.length > 0 && result.rows[0].status === "stopped") {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout: session ${sessionId} did not reach status "stopped"`);
}

test.describe("Stop Stream — session-scoped", () => {
  test.describe.configure({ retries: 2 });

  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: { name: "Stop Stream Assignee", email: "stop-stream@example.com" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.id;
  });

  test("stop returns { stopped: true } when no stream is active", async ({ request }) => {
    // Create a fresh session (no messages sent, no agent running)
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);

    const res = await request.post(`/api/chat-sessions/${session.id}/stop`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    stopStreamResponseSchema.parse(body);
    expect(body.stopped).toBe(true);
  });

  test("stop is idempotent — calling twice returns success", async ({ request }) => {
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    const session = await sessionRes.json();

    const res1 = await request.post(`/api/chat-sessions/${session.id}/stop`);
    expect(res1.ok()).toBeTruthy();
    const body1 = await res1.json();
    expect(body1.stopped).toBe(true);

    const res2 = await request.post(`/api/chat-sessions/${session.id}/stop`);
    expect(res2.ok()).toBeTruthy();
    const body2 = await res2.json();
    expect(body2.stopped).toBe(true);
  });

  test("stop after agent completes returns { stopped: true }", async ({ request, baseURL }) => {
    // Create session and send message
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Subscribe to SSE and send message
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    const msgRes = await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "Hello" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Wait for agent to finish
    const events = await eventsPromise;
    expect(events.map((e) => e.event)).toContain("done");

    // Now stop — should succeed even though stream already completed
    const stopRes = await request.post(`/api/chat-sessions/${sessionId}/stop`);
    expect(stopRes.ok()).toBeTruthy();
    const stopBody = await stopRes.json();
    stopStreamResponseSchema.parse(stopBody);
    expect(stopBody.stopped).toBe(true);

    // Verify session status is stopped
    const statusRes = await request.get(`/api/chat-sessions/${sessionId}`);
    const statusBody = await statusRes.json();
    expect(statusBody.status).toBe("stopped");
  });

  test("stop during active agent stream", async ({ request, baseURL }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Send message to start agent
    const msgRes = await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "Hello" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Immediately call stop (agent might already be done due to mock speed)
    const stopRes = await request.post(`/api/chat-sessions/${sessionId}/stop`);
    expect(stopRes.ok()).toBeTruthy();
    const stopBody = await stopRes.json();
    stopStreamResponseSchema.parse(stopBody);
    expect(stopBody.stopped).toBe(true);

    // Verify session eventually reaches stopped status
    await waitForStopped(sessionId);
  });

  test("stop returns 404 for non-existing session", async ({ request }) => {
    const res = await request.post("/api/chat-sessions/nonexistent-session-id/stop");
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Chat session not found");
  });

  test("user2 cannot stop user1 session", async ({ request }) => {
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    const session = await sessionRes.json();

    const res = await request.post(`/api/chat-sessions/${session.id}/stop`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Stop Stream — assignee-scoped", () => {
  test.describe.configure({ retries: 2 });

  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Stop Chat Assignee",
        email: "stop-chat@example.com",
      },
    });
    expect(res.ok()).toBeTruthy();
    assigneeId = (await res.json()).id;
  });

  test("stop returns { stopped: true } when no session exists", async ({ request }) => {
    // No message ever sent — no session exists
    const res = await request.post(`/api/chat/${assigneeId}/stop`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    stopStreamResponseSchema.parse(body);
    expect(body.stopped).toBe(true);
  });

  test("stop after agent completes returns { stopped: true }", async ({ request, baseURL }) => {
    // Send message (auto-creates session)
    const msgRes = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "Hello" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Wait for agent to finish via DB polling
    const client = createClient({ url: `file:${dbPath}` });
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const result = await client.execute({
        sql: "SELECT status FROM chat_sessions WHERE assignee_id = ? ORDER BY created_at DESC LIMIT 1",
        args: [assigneeId],
      });
      if (result.rows.length > 0 && result.rows[0].status === "stopped") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    client.close();

    // Stop — should succeed
    const stopRes = await request.post(`/api/chat/${assigneeId}/stop`);
    expect(stopRes.ok()).toBeTruthy();
    const stopBody = await stopRes.json();
    stopStreamResponseSchema.parse(stopBody);
    expect(stopBody.stopped).toBe(true);
  });

  test("stop during active agent stream", async ({ request }) => {
    // Create a fresh assignee for this test
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Stop Active Chat",
        email: "stop-active@example.com",
      },
    });
    const testAssigneeId = (await assigneeRes.json()).id;

    // Send message to start agent
    const msgRes = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "Hello" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Immediately call stop
    const stopRes = await request.post(`/api/chat/${testAssigneeId}/stop`);
    expect(stopRes.ok()).toBeTruthy();
    const stopBody = await stopRes.json();
    stopStreamResponseSchema.parse(stopBody);
    expect(stopBody.stopped).toBe(true);

    // Verify session eventually reaches stopped status
    const client = createClient({ url: `file:${dbPath}` });
    const start = Date.now();
    let status = "";
    while (Date.now() - start < 10000) {
      const result = await client.execute({
        sql: "SELECT status FROM chat_sessions WHERE assignee_id = ? ORDER BY created_at DESC LIMIT 1",
        args: [testAssigneeId],
      });
      if (result.rows.length > 0) {
        status = result.rows[0].status as string;
        if (status === "stopped") break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    client.close();
    expect(status).toBe("stopped");
  });

  test("stop returns 404 for non-existing assignee", async ({ request }) => {
    const res = await request.post("/api/chat/nonexistent-assignee-id/stop");
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Assignee not found");
  });

  test("user2 cannot stop user1 assignee chat", async ({ request }) => {
    const res = await request.post(`/api/chat/${assigneeId}/stop`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });
});
