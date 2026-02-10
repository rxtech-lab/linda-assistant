import { test, expect } from "@playwright/test";
import { consumeSSE } from "./helpers/sse-client";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
  sendMessageResponseSchema,
} from "./helpers/schemas";

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

test.describe("Agent Stream", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Test Assistant",
        email: "test@example.com",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.id;
  });

  test("streams text response for simple message", async ({ request, baseURL }) => {
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
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message
    const msgRes = await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "Hello" },
    });
    expect(msgRes.ok()).toBeTruthy();
    sendMessageResponseSchema.parse(await msgRes.json());

    // Await all events until "done"
    const events = await eventsPromise;

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("status");
    expect(eventTypes).toContain("text-delta");
    expect(eventTypes).toContain("done");

    // Check text content
    const textEvents = events.filter((e) => e.event === "text-delta");
    const fullText = textEvents.map((e) => e.data.text).join("");
    expect(fullText).toContain("Hello, world!");

    // Check session status
    const statusRes = await request.get(`/api/chat-sessions/${sessionId}`);
    const statusBody = await statusRes.json();
    chatSessionResponseSchema.parse(statusBody);
    expect(statusBody.status).toBe("stopped");
  });

  test("auto-confirm tool executes without pausing", async ({ request, baseURL }) => {
    // Create assignee with auto-confirm for create_task
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Auto Confirm Assistant",
        email: "auto@example.com",
        toolPermissions: [
          { toolName: "create_task", permission: "auto-confirm" },
        ],
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const autoAssignee = await assigneeRes.json();
    assigneeResponseSchema.parse(autoAssignee);

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId: autoAssignee.id },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE BEFORE posting so we catch all events
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

    // Verify tool-call is create_task
    const toolCallEvent = events.find((e) => e.event === "tool-call");
    expect(toolCallEvent?.data.toolName).toBe("create_task");

    // Session should be stopped (not waiting_confirmation)
    const statusRes = await request.get(`/api/chat-sessions/${sessionId}`);
    const statusBody = await statusRes.json();
    chatSessionResponseSchema.parse(statusBody);
    expect(statusBody.status).toBe("stopped");
  });
});
