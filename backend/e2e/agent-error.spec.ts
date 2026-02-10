import { test, expect } from "@playwright/test";
import { consumeSSE } from "./helpers/sse-client";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
  sendMessageResponseSchema,
} from "./helpers/schemas";

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

test.describe("Agent Tool Error Handling", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Error Test Assistant",
        email: "error-test@example.com",
        toolPermissions: [
          { toolName: "update_task", permission: "auto-confirm" },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.id;
  });

  test("tool error propagates isError in stream and annotates stored messages", async ({
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

    // Subscribe to SSE BEFORE posting so we catch all events
    const eventsPromise = consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } },
    );
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers update_task with a non-existent taskId
    const msgRes = await request.post(
      `/api/chat-sessions/${sessionId}/messages`,
      { data: { content: "[TOOL:update_task] Update task with id non-existent-id-12345 to status finished" } },
    );
    expect(msgRes.ok()).toBeTruthy();
    sendMessageResponseSchema.parse(await msgRes.json());

    // Await all events until "done"
    const events = await eventsPromise;

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("tool-result");
    expect(eventTypes).toContain("done");

    // Verify the tool-call is update_task
    const toolCallEvent = events.find((e) => e.event === "tool-call");
    expect(toolCallEvent?.data.toolName).toBe("update_task");

    // Verify tool-result event has isError and error
    const toolResultEvent = events.find((e) => e.event === "tool-result");
    expect(toolResultEvent?.data.isError).toBe(true);
    expect(toolResultEvent?.data.error).toBeTruthy();
    expect(typeof toolResultEvent?.data.error).toBe("string");

    // Verify stored messages have error annotation on tool-call part
    const statusRes = await request.get(`/api/chat-sessions/${sessionId}`);
    const statusBody = await statusRes.json();
    chatSessionResponseSchema.parse(statusBody);
    expect(statusBody.status).toBe("stopped");

    // Find the assistant message with tool-call parts
    const assistantMessages = statusBody.messages.filter(
      (m: { role: string }) => m.role === "assistant",
    );
    expect(assistantMessages.length).toBeGreaterThan(0);

    // Find tool-call content part with error annotation
    const allMessages = statusBody.messages;
    let foundToolCallError = false;
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part.type === "tool-call" && part.error) {
          foundToolCallError = true;
          expect(typeof part.error).toBe("string");
        }
      }
    }
    expect(foundToolCallError).toBe(true);
  });
});
