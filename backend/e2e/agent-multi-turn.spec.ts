import { test, expect } from "@playwright/test";
import { consumeSSE } from "./helpers/sse-client";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
} from "./helpers/schemas";

test.describe("Agent Multi-Turn", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Multi-Turn Assistant",
        email: "multi@example.com",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.data.id;
  });

  test("handles multi-turn conversation with message history", async ({
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
    const sessionId = session.data.id;

    // Turn 1
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "Hello" },
    });

    const events1 = await consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } }
    );

    const textEvents1 = events1.filter((e) => e.event === "text-delta");
    expect(textEvents1.length).toBeGreaterThan(0);
    const text1 = textEvents1.map((e) => e.data.text).join("");
    expect(text1).toContain("Hello, world!");

    // Verify messages after turn 1
    const session1 = await request.get(`/api/chat-sessions/${sessionId}`);
    const session1Body = await session1.json();
    chatSessionResponseSchema.parse(session1Body);
    expect(session1Body.data.messages.length).toBe(2); // user + assistant
    expect(session1Body.data.status).toBe("stopped");

    // Turn 2
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "How are you?" },
    });

    const events2 = await consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } }
    );

    const textEvents2 = events2.filter((e) => e.event === "text-delta");
    expect(textEvents2.length).toBeGreaterThan(0);

    // Verify messages after turn 2
    const session2 = await request.get(`/api/chat-sessions/${sessionId}`);
    const session2Body = await session2.json();
    chatSessionResponseSchema.parse(session2Body);
    expect(session2Body.data.messages.length).toBe(4); // user1, assistant1, user2, assistant2
    expect(session2Body.data.status).toBe("stopped");
  });

  test("reconnect to stream replays cached chunks", async ({
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
    const sessionId = session.data.id;

    // Send message and complete the stream
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "Hello" },
    });

    const events1 = await consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } }
    );

    const textEvents1 = events1.filter((e) => e.event === "text-delta");
    expect(textEvents1.length).toBeGreaterThan(0);

    // Reconnect — agent is already done, should replay cached chunks
    const events2 = await consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } }
    );

    // Should have replayed text-delta chunks
    const replayedText = events2.filter((e) => e.event === "text-delta");
    expect(replayedText.length).toBeGreaterThan(0);

    // Should have status and done events
    const eventTypes = events2.map((e) => e.event);
    expect(eventTypes).toContain("status");
    expect(eventTypes).toContain("done");
  });
});
