import { createClient } from "@libsql/client";
import { type APIRequestContext, expect, test } from "@playwright/test";
import path from "path";
import {
  assigneeResponseSchema,
  resolveConfirmationResponseSchema,
  sendMessageResponseSchema,
  stopStreamResponseSchema,
} from "./helpers/schemas";
import { consumeSSE } from "./helpers/sse-client";
import { AVAILABLE_MODELS } from "../lib/ai/models";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

/** Delay to ensure SSE subscription + RabbitMQ queue binding is established before posting.
 * Must be long enough for the RabbitMQ exclusive queue to be created and bound,
 * otherwise events published to the exchange before the queue exists are discarded. */
const SUB_DELAY = 1000;

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
  test.describe.configure({ retries: 2 });

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

    const inProgressIdx = resumeEvents.findIndex(
      (e) => e.event === "status" && e.data.status === "in_progress",
    );
    expect(inProgressIdx).toBeGreaterThanOrEqual(0);

    const toolResultIdx = resumeEvents.findIndex((e) => e.event === "tool-result");
    const textDeltaIdx = resumeEvents.findIndex((e) => e.event === "text-delta");
    expect(inProgressIdx).toBeLessThan(toolResultIdx);
    expect(inProgressIdx).toBeLessThan(textDeltaIdx);
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

  test("send_email with document attachment auto-confirms and sends", async ({
    request,
    baseURL,
  }) => {
    // Create assignee with auto-confirm for send_email
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Doc Attach Assistant",
        email: "doc-attach@example.com",
        toolPermissions: [{ toolName: "send_email", permission: "auto-confirm" }],
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = (await assigneeRes.json()).id;

    // Send first message to auto-create session, then wait for it to finish
    await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "Hello" },
    });
    await waitForStopped(request, testAssigneeId);

    // Get the session ID from DB
    const client = createClient({ url: `file:${dbPath}` });
    const sessionResult = await client.execute({
      sql: "SELECT id FROM chat_sessions WHERE assignee_id = ? ORDER BY created_at DESC LIMIT 1",
      args: [testAssigneeId],
    });
    const sessionId = sessionResult.rows[0].id as string;

    // Insert a test document with the known ID that the mock model will reference
    await client.execute({
      sql: "INSERT OR REPLACE INTO documents (id, user_id, chat_session_id, title, format, content) VALUES (?, ?, ?, ?, ?, ?)",
      args: [
        "e2e-test-doc",
        "e2e-test-user",
        sessionId,
        "Test Report",
        "markdown",
        "# Test Report\n\nThis is a test document.",
      ],
    });
    client.close();

    // Subscribe to SSE BEFORE sending the tool-triggering message
    const eventsPromise = consumeSSE(`${baseURL}/api/chat/${testAssigneeId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers send_email with documentId
    const msgRes = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "[TOOL:send_email_with_doc] Send the report as attachment" },
    });
    expect(msgRes.ok()).toBeTruthy();

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("tool-result");
    expect(eventTypes).toContain("done");

    // Verify tool-call is send_email with documentId
    const toolCallEvent = events.find((e) => e.event === "tool-call");
    expect(toolCallEvent?.data.toolName).toBe("send_email");
    expect(toolCallEvent?.data.input.documentId).toBe("e2e-test-doc");

    // Verify tool-result indicates success
    const toolResultEvent = events.find((e) => e.event === "tool-result");
    expect(toolResultEvent?.data.toolName).toBe("send_email");
    expect(toolResultEvent?.data.output).toHaveProperty("sent", true);
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

  test("image attachment rejected when model does not support images", async ({ request }) => {
    // Find a text-only model
    const textOnlyModel = AVAILABLE_MODELS.find((m) => !m.supported_features.includes("image"));
    expect(textOnlyModel).toBeDefined();

    // Create assignee with a text-only model
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Text Only Assistant",
        email: "text-only@example.com",
        model: textOnlyModel!.modelId,
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = (await assigneeRes.json()).id;

    // Send message with image attachment — should be rejected
    const msgRes = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: {
        content: "Look at this image",
        attachments: [{ type: "image", url: "https://example.com/photo.jpg" }],
      },
    });
    expect(msgRes.status()).toBe(422);
    const body = await msgRes.json();
    expect(body.error).toContain("does not support image");
  });

  test("image attachment accepted when model supports images", async ({ request }) => {
    // Find an image-capable model
    const imageModel = AVAILABLE_MODELS.find((m) => m.supported_features.includes("image"));
    expect(imageModel).toBeDefined();

    // Create assignee with an image-capable model
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Image Model Assistant",
        email: "image-model@example.com",
        model: imageModel!.modelId,
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = (await assigneeRes.json()).id;

    // Send message with image attachment — should be accepted
    const msgRes = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: {
        content: "Look at this image",
        attachments: [{ type: "image", url: "https://example.com/photo.jpg" }],
      },
    });
    expect(msgRes.ok()).toBeTruthy();
    sendMessageResponseSchema.parse(await msgRes.json());
  });

  test("POST /api/chat/:assigneeId/stop returns stopped", async ({ request }) => {
    // Stop when no stream is active — should still return stopped: true
    const res = await request.post(`/api/chat/${assigneeId}/stop`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    stopStreamResponseSchema.parse(body);
    expect(body.stopped).toBe(true);
  });

  test("POST /api/chat/:assigneeId/stop with non-existing assignee returns 404", async ({
    request,
  }) => {
    const res = await request.post("/api/chat/nonexistent-assignee/stop");
    expect(res.status()).toBe(404);
  });

  test("summary messages from compaction are excluded from chat history", async ({ request }) => {
    // Create a fresh assignee
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Summary Filter Assistant",
        email: "summary-filter@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const testAssigneeId = (await assigneeRes.json()).id;

    // Send a message to auto-create session
    const msgRes = await request.post(`/api/chat/${testAssigneeId}/message`, {
      data: { content: "Hello" },
    });
    expect(msgRes.ok()).toBeTruthy();
    const sessionId = await waitForStopped(request, testAssigneeId);

    // Verify we have 2 messages (user + assistant)
    const beforeRes = await request.get(`/api/chat/${testAssigneeId}/messages`);
    expect(beforeRes.ok()).toBeTruthy();
    const beforeBody = await beforeRes.json();
    expect(beforeBody.messages.length).toBe(2);

    // Inject a summary message directly into the DB (simulating compaction)
    const client = createClient({ url: `file:${dbPath}` });
    const summaryContent = JSON.stringify([
      {
        type: "text",
        text: "[CONVERSATION SUMMARY]\nThis is a test summary of previous conversation.\n[END SUMMARY]\n\nThe conversation continues below:",
      },
    ]);
    await client.execute({
      sql: "INSERT INTO messages (id, chat_session_id, seq, role, content, is_compacted) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["summary-msg-id", sessionId, -1, "user", summaryContent, 0],
    });
    client.close();

    // Fetch messages again — summary should NOT appear
    const afterRes = await request.get(`/api/chat/${testAssigneeId}/messages`);
    expect(afterRes.ok()).toBeTruthy();
    const afterBody = await afterRes.json();

    // Should still be 2 messages (summary is filtered out)
    expect(afterBody.messages.length).toBe(2);

    // Verify no message contains the summary text
    for (const msg of afterBody.messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            expect(part.text).not.toContain("[CONVERSATION SUMMARY]");
          }
        }
      }
    }
  });
});
