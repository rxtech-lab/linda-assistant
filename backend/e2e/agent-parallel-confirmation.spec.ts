import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import path from "path";
import { consumeSSE } from "./helpers/sse-client";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
  resolveConfirmationResponseSchema,
} from "./helpers/schemas";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

test.describe("Agent Parallel Confirmation", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    // Create assignee with default permissions (all manual-confirm)
    const res = await request.post("/api/assignees", {
      data: {
        name: "Parallel Confirmation Assistant",
        email: "parallel-confirm@example.com",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.id;
  });

  test("parallel tool calls with both auto-confirm execute without pausing", async ({
    request,
    baseURL,
  }) => {
    // Create assignee with both tools set to auto-confirm
    const autoRes = await request.post("/api/assignees", {
      data: {
        name: "Auto Parallel Assistant",
        email: "auto-parallel@example.com",
        toolPermissions: [
          { toolName: "send_email", permission: "auto-confirm" },
          { toolName: "create_task", permission: "auto-confirm" },
        ],
      },
    });
    expect(autoRes.ok()).toBeTruthy();
    const autoAssignee = await autoRes.json();

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId: autoAssignee.id },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE before posting
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers parallel tool calls
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:parallel] Send an email and create a task" },
    });

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    // Should have 2 tool-call events
    const toolCalls = events.filter((e) => e.event === "tool-call");
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((e) => e.data.toolName).sort()).toEqual(["create_task", "send_email"]);

    // Should have 2 tool-result events
    const toolResults = events.filter((e) => e.event === "tool-result");
    expect(toolResults).toHaveLength(2);

    // Should NOT have any confirmation_required
    expect(eventTypes).not.toContain("confirmation_required");

    // Should have text and done
    expect(eventTypes).toContain("text-delta");
    expect(eventTypes).toContain("done");

    // Session should be stopped
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    expect(finalBody.status).toBe("stopped");
  });

  test("parallel tool calls: confirm all, agent resumes", async ({ request, baseURL }) => {
    // Create session with default (manual-confirm) assignee
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE and wait for 2 confirmation_required events
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
      stopOnEventCount: 2,
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers parallel tool calls
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:parallel] Send an email and create a task" },
    });

    const events = await eventsPromise;
    const confirmEvents = events.filter((e) => e.event === "confirmation_required");
    expect(confirmEvents).toHaveLength(2);

    // Verify 2 tool-call events
    const toolCalls = events.filter((e) => e.event === "tool-call");
    expect(toolCalls).toHaveLength(2);

    // Verify session is waiting for confirmation
    const sessionCheck = await request.get(`/api/chat-sessions/${sessionId}`);
    const sessionCheckBody = await sessionCheck.json();
    expect(sessionCheckBody.status).toBe("waiting_confirmation");

    // Query DB for 2 pending confirmations
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id, tool_name FROM confirmations WHERE chat_session_id = ? AND status = 'pending' ORDER BY created_at",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(2);
    const confirmationId1 = result.rows[0].id as string;
    const confirmationId2 = result.rows[1].id as string;

    // Resolve first confirmation — should NOT resume agent yet
    const resolve1 = await request.post(`/api/confirmations/${confirmationId1}/resolve`, {
      data: { action: "confirm" },
    });
    expect(resolve1.ok()).toBeTruthy();
    resolveConfirmationResponseSchema.parse(await resolve1.json());

    // Brief pause to allow any premature resume
    await new Promise((r) => setTimeout(r, 500));

    // Session should still be waiting_confirmation (not in_progress)
    const midCheck = await request.get(`/api/chat-sessions/${sessionId}`);
    const midBody = await midCheck.json();
    expect(midBody.status).toBe("waiting_confirmation");

    // Subscribe to SSE BEFORE resolving second confirmation
    const resumeEventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Resolve second confirmation — NOW agent should resume
    const resolve2 = await request.post(`/api/confirmations/${confirmationId2}/resolve`, {
      data: { action: "confirm" },
    });
    expect(resolve2.ok()).toBeTruthy();
    resolveConfirmationResponseSchema.parse(await resolve2.json());

    // Await resume events
    const resumeEvents = await resumeEventsPromise;
    const resumeEventTypes = resumeEvents.map((e) => e.event);

    // Should have tool-result events for both confirmed tools
    const toolResults = resumeEvents.filter((e) => e.event === "tool-result");
    expect(toolResults).toHaveLength(2);

    // Should have text and done
    expect(resumeEventTypes).toContain("text-delta");
    expect(resumeEventTypes).toContain("done");

    // Session should be stopped
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    expect(finalBody.status).toBe("stopped");

    client.close();
  });

  test("parallel tool calls: confirm one, reject one", async ({ request, baseURL }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE and wait for 2 confirmation_required events
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
      stopOnEventCount: 2,
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers parallel tool calls
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:parallel] Send an email and create a task" },
    });

    await eventsPromise;

    // Query DB for 2 pending confirmations
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id, tool_name FROM confirmations WHERE chat_session_id = ? AND status = 'pending' ORDER BY created_at",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(2);
    const confirmationId1 = result.rows[0].id as string;
    const confirmationId2 = result.rows[1].id as string;

    // Confirm first, reject second
    await request.post(`/api/confirmations/${confirmationId1}/resolve`, {
      data: { action: "confirm" },
    });

    // Subscribe to SSE BEFORE resolving second
    const resumeEventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/confirmations/${confirmationId2}/resolve`, {
      data: { action: "reject" },
    });

    // Await resume events
    const resumeEvents = await resumeEventsPromise;
    const resumeEventTypes = resumeEvents.map((e) => e.event);

    // Should have tool-result events for both (one success, one error)
    const toolResults = resumeEvents.filter((e) => e.event === "tool-result");
    expect(toolResults).toHaveLength(2);

    // One should be an error (the rejected one)
    const errorResults = toolResults.filter((e) => e.data.isError);
    expect(errorResults).toHaveLength(1);

    // Should have text and done (model acknowledges the mixed result)
    expect(resumeEventTypes).toContain("text-delta");
    expect(resumeEventTypes).toContain("done");

    // Session should be stopped
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    expect(finalBody.status).toBe("stopped");

    client.close();
  });

  test("tool-call events re-emitted on resume connection for execution", async ({ request, baseURL }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Subscribe to SSE and wait for 2 confirmation_required events
    const initialEventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
      stopOnEventCount: 2,
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers parallel tool calls
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:parallel] Send an email and create a task" },
    });

    const initialEvents = await initialEventsPromise;

    // Query DB for pending confirmations and resolve all
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending' ORDER BY created_at",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(2);

    // Resolve first (no resume yet)
    await request.post(`/api/confirmations/${result.rows[0].id as string}/resolve`, {
      data: { action: "confirm" },
    });

    // Subscribe before resolving second
    const resumeEventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Resolve second (triggers resume)
    await request.post(`/api/confirmations/${result.rows[1].id as string}/resolve`, {
      data: { action: "confirm" },
    });

    const resumeEvents = await resumeEventsPromise;
    client.close();

    // Initial connection should have 2 tool-call events (from streaming)
    const initialToolCalls = initialEvents.filter((e) => e.event === "tool-call");
    expect(initialToolCalls).toHaveLength(2);

    // Resume connection should also have 2 tool-call events (re-emitted before execution)
    const resumeToolCalls = resumeEvents.filter((e) => e.event === "tool-call");
    expect(resumeToolCalls).toHaveLength(2);

    // Both connections should reference the same 2 unique toolCallIds
    const initialIds = new Set(initialToolCalls.map((e) => e.data.toolCallId));
    const resumeIds = new Set(resumeToolCalls.map((e) => e.data.toolCallId));
    expect(initialIds.size).toBe(2);
    expect(resumeIds.size).toBe(2);
    expect([...resumeIds].every((id) => initialIds.has(id))).toBe(true);
  });
});
