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

test.describe("Agent Confirmation", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    // Create assignee with default permissions (all manual-confirm)
    const res = await request.post("/api/assignees", {
      data: {
        name: "Confirmation Assistant",
        email: "confirm@example.com",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.id;
  });

  test("send_email pauses for confirmation, resumes on confirm", async ({ request, baseURL }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE BEFORE posting so we catch all events
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers send_email
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send a test email" },
    });

    // Stream until confirmation_required
    const events = await eventsPromise;

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("confirmation_required");

    // Check confirmation_required event data
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
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(1);
    const confirmationId = result.rows[0].id as string;
    client.close();

    // Subscribe to SSE BEFORE resolving — resolve publishes a resume task to RabbitMQ
    const resumeEventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Resolve confirmation
    const resolveRes = await request.post(`/api/confirmations/${confirmationId}/resolve`, {
      data: { action: "confirm" },
    });
    expect(resolveRes.ok()).toBeTruthy();
    resolveConfirmationResponseSchema.parse(await resolveRes.json());

    // Await resume events — agent should resume and complete
    const resumeEvents = await resumeEventsPromise;

    const resumeEventTypes = resumeEvents.map((e) => e.event);
    expect(resumeEventTypes).toContain("tool-result");
    expect(resumeEventTypes).toContain("text-delta");
    expect(resumeEventTypes).toContain("done");

    const inProgressIdx = resumeEvents.findIndex(
      (e) => e.event === "status" && e.data.status === "in_progress",
    );
    expect(inProgressIdx).toBeGreaterThanOrEqual(0);

    // Verify tool-result event is emitted after confirmation
    const toolResultEvent = resumeEvents.find((e) => e.event === "tool-result");
    expect(toolResultEvent?.data.toolCallId).toBeTruthy();
    expect(toolResultEvent?.data.toolName).toBe("send_email");

    // tool-result should come before text-delta
    const toolResultIdx = resumeEvents.findIndex((e) => e.event === "tool-result");
    const textDeltaIdx = resumeEvents.findIndex((e) => e.event === "text-delta");
    expect(inProgressIdx).toBeLessThan(toolResultIdx);
    expect(inProgressIdx).toBeLessThan(textDeltaIdx);
    expect(toolResultIdx).toBeLessThan(textDeltaIdx);

    // Check that the resumed text contains expected content
    const textEvents = resumeEvents.filter((e) => e.event === "text-delta");
    const fullText = textEvents.map((e) => e.data.text).join("");
    expect(fullText).toContain("Email sent successfully.");

    // Session should be stopped
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    chatSessionResponseSchema.parse(finalBody);
    expect(finalBody.status).toBe("stopped");
  });

  test("send_email pauses, resumes on reject", async ({ request, baseURL }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE BEFORE posting so we catch all events
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers send_email
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send a test email" },
    });

    // Stream until confirmation_required
    await eventsPromise;

    // Query DB for pending confirmation
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(1);
    const confirmationId = result.rows[0].id as string;
    client.close();

    // Subscribe to SSE before rejecting — rejection now resumes the agent
    const rejectEventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Reject the confirmation
    const resolveRes = await request.post(`/api/confirmations/${confirmationId}/resolve`, {
      data: { action: "reject" },
    });
    expect(resolveRes.ok()).toBeTruthy();
    resolveConfirmationResponseSchema.parse(await resolveRes.json());

    // Agent should resume, model acknowledges rejection, then complete
    const rejectEvents = await rejectEventsPromise;
    const rejectEventTypes = rejectEvents.map((e) => e.event);

    expect(rejectEventTypes).toContain("text-delta");
    expect(rejectEventTypes).toContain("done");

    // Session should be stopped
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    expect(finalBody.status).toBe("stopped");
  });

  test("reject while connected to stream delivers events", async ({ request, baseURL }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Subscribe to SSE and send message that triggers send_email
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send a test email" },
    });

    await eventsPromise;

    // Get pending confirmation ID
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(1);
    const confirmationId = result.rows[0].id as string;
    client.close();

    // Subscribe to SSE BEFORE rejecting so we catch the rejection events
    const rejectEventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Reject the confirmation
    const resolveRes = await request.post(`/api/confirmations/${confirmationId}/resolve`, {
      data: { action: "reject" },
    });
    expect(resolveRes.ok()).toBeTruthy();

    // Agent resumes, model acknowledges rejection, then completes
    const rejectEvents = await rejectEventsPromise;
    const rejectEventTypes = rejectEvents.map((e) => e.event);

    // Should see text from model acknowledging rejection, then done
    expect(rejectEventTypes).toContain("text-delta");
    expect(rejectEventTypes).toContain("status");
    expect(rejectEventTypes).toContain("done");

    // Verify status is stopped
    const statusEvent = rejectEvents.find(
      (e) => e.event === "status" && e.data.status === "stopped",
    );
    expect(statusEvent).toBeTruthy();
  });

  test("reject while disconnected, then connect shows stopped status", async ({
    request,
    baseURL,
  }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Subscribe to SSE and send message that triggers send_email
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send a test email" },
    });

    await eventsPromise;

    // Get pending confirmation ID
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(1);
    const confirmationId = result.rows[0].id as string;
    client.close();

    // Reject WITHOUT an SSE connection — agent resumes in background
    const resolveRes = await request.post(`/api/confirmations/${confirmationId}/resolve`, {
      data: { action: "reject" },
    });
    expect(resolveRes.ok()).toBeTruthy();

    // Wait for the agent to finish in the background
    await new Promise((r) => setTimeout(r, 2000));

    // Now connect to SSE AFTER agent has finished
    const lateEvents = await consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "status",
      timeoutMs: 5000,
    });

    // The stream route sends initial status on connect — should be "stopped"
    const statusEvent = lateEvents.find((e) => e.event === "status");
    expect(statusEvent).toBeTruthy();
    expect(statusEvent?.data.status).toBe("stopped");
  });
});
