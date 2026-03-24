import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import path from "path";
import { consumeSSE } from "./helpers/sse-client";
import { assigneeResponseSchema, chatSessionResponseSchema } from "./helpers/schemas";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

test.describe("Agent Conditional Auto-Confirm", () => {
  test("conditions met → auto-approve without confirmation", async ({ request, baseURL }) => {
    // Create assignee with conditional auto-confirm on send_email:
    // auto-confirm only when "to" ends with "@example.com"
    const res = await request.post("/api/assignees", {
      data: {
        name: "Conditional Auto Assistant",
        email: "cond-auto@example.com",
        toolPermissions: [
          {
            toolName: "send_email",
            permission: "auto-confirm",
            conditions: [
              {
                parameterName: "to",
                parameterType: "string",
                operator: "endsWith",
                value: "@example.com",
              },
            ],
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    const assigneeId = body.id;

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
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

    // Send message that triggers send_email — the E2E mock will use to=test@example.com
    // which matches the condition
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send a test email to test@example.com" },
    });

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    // Should have tool-call and tool-result (auto-approved)
    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("tool-result");
    expect(eventTypes).toContain("text-delta");
    expect(eventTypes).toContain("done");

    // Should NOT have confirmation_required — conditions were met
    expect(eventTypes).not.toContain("confirmation_required");

    // Session should be stopped (completed normally)
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    expect(finalBody.status).toBe("stopped");

    // Verify no pending confirmations were created
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(0);
    client.close();
  });

  test("conditions not met → manual confirmation required", async ({ request, baseURL }) => {
    // Create assignee with conditional auto-confirm on send_email:
    // auto-confirm only when "to" ends with "@example.com"
    const res = await request.post("/api/assignees", {
      data: {
        name: "Conditional Manual Assistant",
        email: "cond-manual@example.com",
        toolPermissions: [
          {
            toolName: "send_email",
            permission: "auto-confirm",
            conditions: [
              {
                parameterName: "to",
                parameterType: "string",
                operator: "endsWith",
                value: "@example.com",
              },
            ],
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    const assigneeId = body.id;

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE BEFORE posting
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message — the E2E mock will use to=someone@other.com which does NOT match
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send a test email to someone@other.com" },
    });

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    // Should have confirmation_required — conditions were NOT met
    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("confirmation_required");

    // Session should be waiting for confirmation
    const sessionCheck = await request.get(`/api/chat-sessions/${sessionId}`);
    const sessionCheckBody = await sessionCheck.json();
    expect(sessionCheckBody.status).toBe("waiting_confirmation");

    // Verify pending confirmation was created
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(1);
    client.close();
  });

  test("multiple conditions (AND) — one fails → manual confirmation", async ({
    request,
    baseURL,
  }) => {
    // Create assignee with two conditions: "to" endsWith "@example.com" AND "subject" contains "report"
    const res = await request.post("/api/assignees", {
      data: {
        name: "Multi Condition Assistant",
        email: "multi-cond@example.com",
        toolPermissions: [
          {
            toolName: "send_email",
            permission: "auto-confirm",
            conditionLogic: "and",
            conditions: [
              {
                parameterName: "to",
                parameterType: "string",
                operator: "endsWith",
                value: "@example.com",
              },
              {
                parameterName: "subject",
                parameterType: "string",
                operator: "contains",
                value: "report",
              },
            ],
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    const assigneeId = body.id;

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Subscribe to SSE
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message — "to" matches but "subject" may not contain "report"
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: {
        content:
          "[TOOL:send_email] Send a greeting email to test@example.com with subject Hello World",
      },
    });

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    // Should require confirmation because subject condition fails
    expect(eventTypes).toContain("confirmation_required");

    const sessionCheck = await request.get(`/api/chat-sessions/${sessionId}`);
    const sessionCheckBody = await sessionCheck.json();
    expect(sessionCheckBody.status).toBe("waiting_confirmation");
  });

  test("multiple conditions (OR) — one passes → auto-approve", async ({ request, baseURL }) => {
    // Create assignee with OR logic: "to" endsWith "@example.com" OR "subject" contains "report"
    const res = await request.post("/api/assignees", {
      data: {
        name: "OR Logic Auto Assistant",
        email: "or-auto@example.com",
        toolPermissions: [
          {
            toolName: "send_email",
            permission: "auto-confirm",
            conditionLogic: "or",
            conditions: [
              {
                parameterName: "to",
                parameterType: "string",
                operator: "endsWith",
                value: "@example.com",
              },
              {
                parameterName: "subject",
                parameterType: "string",
                operator: "contains",
                value: "report",
              },
            ],
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    const assigneeId = body.id;

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Subscribe to SSE
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message — "to" matches @example.com (first condition passes), subject doesn't matter
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: {
        content: "[TOOL:send_email] Send a test email to test@example.com with subject Hello World",
      },
    });

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    // OR logic: one condition passes → auto-approved
    expect(eventTypes).not.toContain("confirmation_required");
    expect(eventTypes).toContain("tool-result");
    expect(eventTypes).toContain("done");

    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    expect(finalBody.status).toBe("stopped");
  });

  test("multiple conditions (OR) — none pass → manual confirmation", async ({
    request,
    baseURL,
  }) => {
    // Create assignee with OR logic: "to" endsWith "@example.com" OR "subject" contains "report"
    const res = await request.post("/api/assignees", {
      data: {
        name: "OR Logic Manual Assistant",
        email: "or-manual@example.com",
        toolPermissions: [
          {
            toolName: "send_email",
            permission: "auto-confirm",
            conditionLogic: "or",
            conditions: [
              {
                parameterName: "to",
                parameterType: "string",
                operator: "endsWith",
                value: "@example.com",
              },
              {
                parameterName: "subject",
                parameterType: "string",
                operator: "contains",
                value: "report",
              },
            ],
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    const assigneeId = body.id;

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Subscribe to SSE
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "confirmation_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message — neither condition passes: "to" is @other.com, subject has no "report"
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: {
        content:
          "[TOOL:send_email] Send a greeting email to someone@other.com with subject Hello World",
      },
    });

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    // OR logic: no conditions pass → manual confirmation required
    expect(eventTypes).toContain("confirmation_required");

    const sessionCheck = await request.get(`/api/chat-sessions/${sessionId}`);
    const sessionCheckBody = await sessionCheck.json();
    expect(sessionCheckBody.status).toBe("waiting_confirmation");
  });

  test("empty conditions → unconditional auto-confirm (backward compat)", async ({
    request,
    baseURL,
  }) => {
    // Create assignee with auto-confirm and empty conditions array
    const res = await request.post("/api/assignees", {
      data: {
        name: "Empty Conditions Assistant",
        email: "empty-cond@example.com",
        toolPermissions: [
          {
            toolName: "send_email",
            permission: "auto-confirm",
            conditions: [],
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const assigneeId = body.id;

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    // Subscribe to SSE
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send a test email" },
    });

    const events = await eventsPromise;
    const eventTypes = events.map((e) => e.event);

    // Empty conditions = unconditional auto-confirm, no confirmation needed
    expect(eventTypes).not.toContain("confirmation_required");
    expect(eventTypes).toContain("tool-result");
    expect(eventTypes).toContain("done");

    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    expect(finalBody.status).toBe("stopped");
  });
});
