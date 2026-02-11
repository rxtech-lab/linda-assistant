import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import path from "path";
import { consumeSSE } from "./helpers/sse-client";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
  sendMessageResponseSchema,
  resolveConfirmationResponseSchema,
} from "./helpers/schemas";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

test.describe("Agent Permissions", () => {
  test("auto-reject: tool filtered out, no execution", async ({ request, baseURL }) => {
    // Create assignee with auto-reject for create_task
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Reject Assistant",
        email: "reject@example.com",
        toolPermissions: [{ toolName: "create_task", permission: "auto-reject" }],
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const assignee = await assigneeRes.json();
    assigneeResponseSchema.parse(assignee);

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId: assignee.id },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE BEFORE posting
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that tries to trigger create_task — but tool is auto-rejected
    const msgRes = await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:create_task] Create a task" },
    });
    expect(msgRes.ok()).toBeTruthy();
    sendMessageResponseSchema.parse(await msgRes.json());

    // Stream should complete without tool-call (mock falls through to default text)
    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    expect(eventTypes).not.toContain("tool-call");
    expect(eventTypes).toContain("text-delta");
    expect(eventTypes).toContain("done");

    // Session should be stopped
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    expect(finalBody.status).toBe("stopped");
  });

  test("auto-confirm: executes without pausing", async ({ request, baseURL }) => {
    // Create assignee with auto-confirm for create_task
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Auto Confirm Perm Assistant",
        email: "autoperm@example.com",
        toolPermissions: [{ toolName: "create_task", permission: "auto-confirm" }],
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const assignee = await assigneeRes.json();
    assigneeResponseSchema.parse(assignee);

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId: assignee.id },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers create_task
    const msgRes = await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:create_task] Create a test task" },
    });
    expect(msgRes.ok()).toBeTruthy();
    sendMessageResponseSchema.parse(await msgRes.json());

    // Stream should complete without pausing
    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("tool-result");
    expect(eventTypes).toContain("text-delta");
    expect(eventTypes).toContain("done");
    expect(eventTypes).not.toContain("confirmation_required");

    // Verify tool-call is create_task
    const toolCallEvent = events.find((e) => e.event === "tool-call");
    expect(toolCallEvent?.data.toolName).toBe("create_task");

    // Session should be stopped (not waiting_confirmation)
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    chatSessionResponseSchema.parse(finalBody);
    expect(finalBody.status).toBe("stopped");
  });

  test("manual-confirm: pauses for confirmation", async ({ request, baseURL }) => {
    // Create assignee with NO toolPermissions (defaults to manual-confirm for all tools)
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Manual Confirm Assistant",
        email: "manual@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const assignee = await assigneeRes.json();
    assigneeResponseSchema.parse(assignee);

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId: assignee.id },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE BEFORE posting (stop on confirmation_required)
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers send_email
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send an email" },
    });

    // Stream until confirmation_required
    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("confirmation_required");

    // Verify confirmation_required event data
    const confirmEvent = events.find((e) => e.event === "confirmation_required");
    expect(confirmEvent?.data.toolName).toBe("send_email");

    // Verify session is waiting for confirmation
    const sessionCheck = await request.get(`/api/chat-sessions/${sessionId}`);
    const sessionCheckBody = await sessionCheck.json();
    chatSessionResponseSchema.parse(sessionCheckBody);
    expect(sessionCheckBody.status).toBe("waiting_confirmation");

    // Query DB directly for pending confirmation
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id, approval_id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].approval_id).toBeTruthy();
    client.close();
  });

  test("always-allow: updates permissions, next call auto-confirms", async ({
    request,
    baseURL,
  }) => {
    // Create assignee with NO toolPermissions (defaults to manual-confirm)
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Always Allow Assistant",
        email: "always@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const assignee = await assigneeRes.json();
    assigneeResponseSchema.parse(assignee);
    const assigneeId = assignee.id;

    // --- Step 1: Trigger send_email → pauses at confirmation ---
    const session1Res = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(session1Res.ok()).toBeTruthy();
    const session1 = await session1Res.json();
    const sessionId1 = session1.id;

    const events1Promise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId1}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId1}/messages`, {
      data: { content: "[TOOL:send_email] Send an email" },
    });

    await events1Promise;

    // Get pending confirmation ID
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId1],
    });
    expect(result.rows.length).toBe(1);
    const confirmationId = result.rows[0].id as string;
    client.close();

    // --- Step 2: Resolve with alwaysAllow ---
    const resumeEventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId1}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    const resolveRes = await request.post(`/api/confirmations/${confirmationId}/resolve`, {
      data: { action: "confirm", alwaysAllow: true },
    });
    expect(resolveRes.ok()).toBeTruthy();
    resolveConfirmationResponseSchema.parse(await resolveRes.json());

    // Agent should resume, execute tool, and complete
    const resumeEvents = await resumeEventsPromise;
    const resumeEventTypes = resumeEvents.map((e) => e.event);
    expect(resumeEventTypes).toContain("tool-result");
    expect(resumeEventTypes).toContain("text-delta");
    expect(resumeEventTypes).toContain("done");

    // Session should be stopped
    const finalSession1 = await request.get(`/api/chat-sessions/${sessionId1}`);
    const finalBody1 = await finalSession1.json();
    expect(finalBody1.status).toBe("stopped");

    // --- Step 3: Verify assignee permissions were updated ---
    const updatedAssignee = await request.get(`/api/assignees/${assigneeId}`);
    const updatedBody = await updatedAssignee.json();
    assigneeResponseSchema.parse(updatedBody);
    expect(updatedBody.toolPermissions).toContainEqual({
      toolName: "send_email",
      permission: "auto-confirm",
    });

    // --- Step 4: New session — send_email should auto-confirm now ---
    const session2Res = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(session2Res.ok()).toBeTruthy();
    const session2 = await session2Res.json();
    const sessionId2 = session2.id;

    const events2Promise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId2}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId2}/messages`, {
      data: { content: "[TOOL:send_email] Send another email" },
    });

    const events2 = await events2Promise;
    const event2Types = events2.map((e) => e.event);

    // Should auto-confirm — no confirmation_required
    expect(event2Types).toContain("tool-call");
    expect(event2Types).toContain("tool-result");
    expect(event2Types).toContain("done");
    expect(event2Types).not.toContain("confirmation_required");

    // Session should be stopped
    const finalSession2 = await request.get(`/api/chat-sessions/${sessionId2}`);
    const finalBody2 = await finalSession2.json();
    expect(finalBody2.status).toBe("stopped");
  });
});
