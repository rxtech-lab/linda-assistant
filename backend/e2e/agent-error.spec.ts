import { expect, test } from "@playwright/test";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
  sendMessageResponseSchema,
} from "./helpers/schemas";
import { consumeSSE } from "./helpers/sse-client";

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

test.describe("Agent Tool Error Handling", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Error Test Assistant",
        email: "error-test@example.com",
        toolPermissions: [{ toolName: "update_task", permission: "auto-confirm" }],
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
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers update_task with a non-existent taskId
    const msgRes = await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: {
        content: "[TOOL:update_task] Update task with id non-existent-id-12345 to status finished",
      },
    });
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

    // Verify session is stopped
    const statusRes = await request.get(`/api/chat-sessions/${sessionId}`);
    const statusBody = await statusRes.json();
    chatSessionResponseSchema.parse(statusBody);
    expect(statusBody.status).toBe("stopped");

    // Verify stored messages have error annotation on tool-call part
    const msgsRes = await request.get(`/api/chat-sessions/${sessionId}/messages`);
    const msgsBody = await msgsRes.json();

    // Find the assistant message with tool-call parts
    const assistantMessages = msgsBody.messages.filter(
      (m: { role: string }) => m.role === "assistant",
    );
    expect(assistantMessages.length).toBeGreaterThan(0);

    // Find tool-call content part with error annotation
    let foundToolCallError = false;
    for (const msg of msgsBody.messages) {
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

  test("failed tool-result messages are stored in the message history", async ({
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
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers update_task with a non-existent taskId
    const msgRes = await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: {
        content: "[TOOL:update_task] Update task with id non-existent-id-99999 to status finished",
      },
    });
    expect(msgRes.ok()).toBeTruthy();
    sendMessageResponseSchema.parse(await msgRes.json());

    // Await all events until "done"
    const events = await eventsPromise;
    expect(events.map((e) => e.event)).toContain("done");

    // Fetch stored messages
    const msgsRes = await request.get(`/api/chat-sessions/${sessionId}/messages`);
    expect(msgsRes.ok()).toBeTruthy();
    const msgsBody = await msgsRes.json();

    // There should be at least 3 messages:
    //   1. user message
    //   2. assistant message with tool-call content
    //   3. tool message with tool-result content (the failed result)
    // And possibly a final assistant text message
    expect(msgsBody.messages.length).toBeGreaterThanOrEqual(3);

    // Verify user message is present
    const userMsg = msgsBody.messages.find((m: { role: string }) => m.role === "user");
    expect(userMsg).toBeTruthy();

    // Verify assistant message with tool-call is present
    const assistantWithToolCall = msgsBody.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some((p: { type: string }) => p.type === "tool-call"),
    );
    expect(assistantWithToolCall).toBeTruthy();

    // Verify tool message with tool-result is stored in history
    const toolMsg = msgsBody.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === "tool" &&
        Array.isArray(m.content) &&
        m.content.some((p: { type: string }) => p.type === "tool-result"),
    );
    expect(toolMsg).toBeTruthy();
    expect(toolMsg.id).toBeTruthy();

    // Verify the tool-result part contains error information
    const toolResultPart = toolMsg.content.find((p: { type: string }) => p.type === "tool-result");
    expect(toolResultPart).toBeTruthy();
    expect(toolResultPart.toolCallId).toBeTruthy();
    expect(toolResultPart.toolName).toBe("update_task");

    // The tool-result should indicate an error via isError flag, error output, or error-text type
    const output = toolResultPart.output;
    const hasIsError = toolResultPart.isError === true;
    let hasErrorInOutput = false;
    if (typeof output === "object" && output !== null) {
      // Output could be wrapped in { type: "json", value: ... } or { type: "error-text", value: ... }
      const value = output.value ?? output;
      hasErrorInOutput =
        output.type === "error-text" ||
        (typeof value === "object" && value !== null && "error" in value);
    } else if (typeof output === "string") {
      // Raw error string
      hasErrorInOutput = output.length > 0;
    }
    expect(hasIsError || hasErrorInOutput).toBe(true);

    // Verify the tool-call and tool-result reference the same toolCallId
    const toolCallPart = assistantWithToolCall.content.find(
      (p: { type: string }) => p.type === "tool-call",
    );
    expect(toolCallPart.toolCallId).toBe(toolResultPart.toolCallId);

    // Verify all messages have unique IDs
    const allIds = msgsBody.messages.map((m: { id: string }) => m.id);
    expect(new Set(allIds).size).toBe(allIds.length);

    // Verify message ordering: user comes before assistant tool-call,
    // which comes before tool result
    const userIdx = msgsBody.messages.findIndex((m: { role: string }) => m.role === "user");
    const assistantToolCallIdx = msgsBody.messages.indexOf(assistantWithToolCall);
    const toolIdx = msgsBody.messages.indexOf(toolMsg);
    expect(userIdx).toBeLessThan(assistantToolCallIdx);
    expect(assistantToolCallIdx).toBeLessThan(toolIdx);
  });
});
