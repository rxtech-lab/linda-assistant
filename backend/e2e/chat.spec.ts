import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@libsql/client";
import path from "path";
import { consumeSSE } from "./helpers/sse-client";
import {
  assigneeResponseSchema,
  sendMessageResponseSchema,
  resolveConfirmationResponseSchema,
} from "./helpers/schemas";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

async function waitForStopped(request: APIRequestContext, assigneeId: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Look up the session via DB since we don't have the session ID
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

test.describe("Chat Endpoints", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Chat Test Assistant",
        email: "chat-test@example.com",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.id;
  });

  test("basic text streaming", async ({ request, baseURL }) => {
    // Send message (auto-creates session)
    const msgRes = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "Hello" },
    });
    expect(msgRes.ok()).toBeTruthy();
    sendMessageResponseSchema.parse(await msgRes.json());

    // Wait for agent to finish processing
    await waitForStopped(request, assigneeId);

    // Verify messages are stored correctly
    const messagesRes = await request.get(`/api/chat/${assigneeId}/messages`);
    expect(messagesRes.ok()).toBeTruthy();
    const messagesBody = await messagesRes.json();
    expect(messagesBody.messages.length).toBe(2);
    expect(messagesBody.messages[0].role).toBe("user");
    expect(messagesBody.messages[1].role).toBe("assistant");
  });

  test("persistent conversation — same session reused across turns", async ({ request }) => {
    // Create a fresh assignee for this test
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Persistent Chat Assistant",
        email: "persistent@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const assignee = await assigneeRes.json();
    const testAssigneeId = assignee.id;

    // Turn 1: send message (auto-creates session)
    const msg1Res = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "First message" },
    });
    expect(msg1Res.ok()).toBeTruthy();
    await waitForStopped(request, testAssigneeId);

    // Turn 2: send another message (should reuse same session)
    const msg2Res = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "Second message" },
    });
    expect(msg2Res.ok()).toBeTruthy();
    await waitForStopped(request, testAssigneeId);

    // Verify: GET messages shows 4 messages (2 user + 2 assistant)
    const messagesRes = await request.get(`/api/chat/${testAssigneeId}/messages`);
    expect(messagesRes.ok()).toBeTruthy();
    const messagesBody = await messagesRes.json();
    expect(messagesBody.messages.length).toBe(4);
    expect(messagesBody.nextCursor).toBeNull();

    // Check roles alternate: user, assistant, user, assistant
    expect(messagesBody.messages[0].role).toBe("user");
    expect(messagesBody.messages[1].role).toBe("assistant");
    expect(messagesBody.messages[2].role).toBe("user");
    expect(messagesBody.messages[3].role).toBe("assistant");
  });

  test("message pagination with cursor", async ({ request, baseURL }) => {
    // Create a fresh assignee
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Pagination Chat Assistant",
        email: "pagination@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = assigneeRes.json().then((b) => b.id);
    const aid = await testAssigneeId;

    // Send 3 messages to build up history (6 messages total: 3 user + 3 assistant)
    for (let i = 0; i < 3; i++) {
      const msgRes = await request.post(`/api/chat/${aid}/message`, {
        data: { content: `Message ${i + 1}` },
      });
      expect(msgRes.ok()).toBeTruthy();

      // Wait for each to complete before sending next
      await waitForStopped(request, aid);
    }

    // Get last 2 messages
    const page1Res = await request.get(`/api/chat/${aid}/messages?limit=2`);
    expect(page1Res.ok()).toBeTruthy();
    const page1 = await page1Res.json();
    expect(page1.messages.length).toBe(2);
    expect(page1.nextCursor).toBeTruthy(); // There are more messages

    // Use cursor to load older messages
    const page2Res = await request.get(
      `/api/chat/${aid}/messages?limit=2&before=${page1.nextCursor}`,
    );
    expect(page2Res.ok()).toBeTruthy();
    const page2 = await page2Res.json();
    expect(page2.messages.length).toBe(2);

    // Pages should not overlap
    const page1Ids = page1.messages.map((m: { id: string }) => m.id);
    const page2Ids = page2.messages.map((m: { id: string }) => m.id);
    for (const id of page1Ids) {
      expect(page2Ids).not.toContain(id);
    }
  });

  test("auto-confirm tool executes without pausing", async ({ request, baseURL }) => {
    // Create assignee with auto-confirm for create_task
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Chat Auto Confirm",
        email: "chat-auto@example.com",
        toolPermissions: [{ toolName: "create_task", permission: "auto-confirm" }],
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = (await assigneeRes.json()).id;

    // Send first message to auto-create session, then wait for it to finish
    await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "Hello" },
    });
    await waitForStopped(request, testAssigneeId);

    // Subscribe to SSE BEFORE sending the tool-triggering message
    const eventsPromise = consumeSSE(`${baseURL}/api/chat/${testAssigneeId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers create_task
    const msgRes = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "[TOOL:create_task] Create a test task" },
    });
    expect(msgRes.ok()).toBeTruthy();

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("tool-result");
    expect(eventTypes).toContain("text-delta");
    expect(eventTypes).toContain("done");

    // Verify tool-call is create_task
    const toolCallEvent = events.find((e) => e.event === "tool-call");
    expect(toolCallEvent?.data.toolName).toBe("create_task");
  });

  test("confirmation flow — send_email pauses, confirm resumes", async ({ request, baseURL }) => {
    // Create assignee with default permissions (manual-confirm for all)
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Chat Confirm Assistant",
        email: "chat-confirm@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = (await assigneeRes.json()).id;

    // Send first message to auto-create session, then wait for it to finish
    await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "Hello" },
    });
    await waitForStopped(request, testAssigneeId);

    // Subscribe to SSE BEFORE sending the tool-triggering message
    const eventsPromise = consumeSSE(`${baseURL}/api/chat/${testAssigneeId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers send_email
    const msgRes = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "[TOOL:send_email] Send a test email" },
    });
    expect(msgRes.ok()).toBeTruthy();

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("confirmation_required");

    const confirmEvent = events.find((e) => e.event === "confirmation_required");
    expect(confirmEvent?.data.toolName).toBe("send_email");

    // Get the session ID and confirmation ID from DB
    const client = createClient({ url: `file:${dbPath}` });
    const sessionResult = await client.execute({
      sql: "SELECT id FROM chat_sessions WHERE assignee_id = ? ORDER BY created_at DESC LIMIT 1",
      args: [testAssigneeId],
    });
    const sessionId = sessionResult.rows[0].id as string;

    const confirmResult = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(confirmResult.rows.length).toBe(1);
    const confirmationId = confirmResult.rows[0].id as string;
    client.close();

    // Subscribe to SSE before resolving
    const resumeEventsPromise = consumeSSE(`${baseURL}/api/chat/${testAssigneeId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Resolve confirmation
    const resolveRes = await request.post(`/api/confirmations/${confirmationId}/resolve`, {
      data: { action: "confirm" },
    });
    expect(resolveRes.ok()).toBeTruthy();
    resolveConfirmationResponseSchema.parse(await resolveRes.json());

    // Agent should resume and complete
    const resumeEvents = await resumeEventsPromise;
    const resumeEventTypes = resumeEvents.map((e) => e.event);
    expect(resumeEventTypes).toContain("tool-result");
    expect(resumeEventTypes).toContain("text-delta");
    expect(resumeEventTypes).toContain("done");
  });

  test("clear messages deletes all messages", async ({ request }) => {
    // Create a fresh assignee
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Clear Chat Assistant",
        email: "clear-chat@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = (await assigneeRes.json()).id;

    // Send a message to auto-create session
    const msgRes = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "Hello" },
    });
    expect(msgRes.ok()).toBeTruthy();
    await waitForStopped(request, testAssigneeId);

    // Verify messages exist
    const beforeRes = await request.get(`/api/chat/${testAssigneeId}/messages`);
    expect(beforeRes.ok()).toBeTruthy();
    const beforeBody = await beforeRes.json();
    expect(beforeBody.messages.length).toBeGreaterThan(0);

    // Clear messages
    const deleteRes = await request.delete(`/api/chat/${testAssigneeId}/messages`);
    expect(deleteRes.ok()).toBeTruthy();
    const deleteBody = await deleteRes.json();
    expect(deleteBody.deleted).toBe(true);

    // Verify messages are now empty
    const afterRes = await request.get(`/api/chat/${testAssigneeId}/messages`);
    expect(afterRes.ok()).toBeTruthy();
    const afterBody = await afterRes.json();
    expect(afterBody.messages.length).toBe(0);
    expect(afterBody.nextCursor).toBeNull();
  });

  test("clear messages on non-existent session returns 404", async ({ request }) => {
    // Create assignee with no session
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "No Session Clear",
        email: "nosession-clear@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = (await assigneeRes.json()).id;

    const res = await request.delete(`/api/chat/${testAssigneeId}/messages`);
    expect(res.status()).toBe(404);
  });

  test("stream before message returns 404", async ({ request }) => {
    // Create a fresh assignee with no session
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "No Session Assistant",
        email: "nosession@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = (await assigneeRes.json()).id;

    // Try to stream — should get 404
    const streamRes = await request.get(`/api/chat/${testAssigneeId}/stream`);
    expect(streamRes.status()).toBe(404);

    // Try to get messages — should also get 404
    const messagesRes = await request.get(`/api/chat/${testAssigneeId}/messages`);
    expect(messagesRes.status()).toBe(404);
  });
});
