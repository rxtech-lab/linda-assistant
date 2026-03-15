import { test, expect } from "@playwright/test";
import { taskResponseSchema } from "./helpers/schemas";

test.describe("Task timezone handling", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: { name: "Timezone Test Assignee", email: "tz-test@example.com" },
    });
    expect(res.ok()).toBeTruthy();
    assigneeId = (await res.json()).id;
  });

  test("chat session stores timezone from message", async ({ request }) => {
    // Send a message with timezone
    const msgRes = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "Hello", timezone: "America/New_York" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Verify the chat session has the timezone
    const sessionsRes = await request.get("/api/chat-sessions");
    expect(sessionsRes.ok()).toBeTruthy();
    const sessions = await sessionsRes.json();
    const session = sessions.data.find((s: { assigneeId: string }) => s.assigneeId === assigneeId);
    expect(session).toBeTruthy();
    expect(session.timezone).toBe("America/New_York");
  });

  test("chat session updates timezone on subsequent messages", async ({ request }) => {
    // Send another message with a different timezone
    const msgRes = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "Hello again", timezone: "Asia/Tokyo" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Verify the timezone was updated
    const sessionsRes = await request.get("/api/chat-sessions");
    expect(sessionsRes.ok()).toBeTruthy();
    const sessions = await sessionsRes.json();
    const session = sessions.data.find((s: { assigneeId: string }) => s.assigneeId === assigneeId);
    expect(session).toBeTruthy();
    expect(session.timezone).toBe("Asia/Tokyo");
  });

  test("chat session preserves timezone when message omits it", async ({ request }) => {
    // Send a message without timezone
    const msgRes = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "No timezone this time" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Timezone should still be the previously set value
    const sessionsRes = await request.get("/api/chat-sessions");
    expect(sessionsRes.ok()).toBeTruthy();
    const sessions = await sessionsRes.json();
    const session = sessions.data.find((s: { assigneeId: string }) => s.assigneeId === assigneeId);
    expect(session).toBeTruthy();
    expect(session.timezone).toBe("Asia/Tokyo");
  });

  test("creating a task with runsAt uses timezone offset as-is", async ({ request }) => {
    // runsAt with explicit timezone offset is stored as-is
    const res = await request.post("/api/tasks", {
      data: {
        title: "Scheduled Task with TZ",
        assigneeId,
        runsAt: "2025-06-15T09:00:00+05:30",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.runsAt).toBe("2025-06-15T09:00:00+05:30");
    expect(body.status).toBe("running");
  });

  test("session detail includes timezone field", async ({ request }) => {
    // Get all sessions and find ours
    const sessionsRes = await request.get("/api/chat-sessions");
    expect(sessionsRes.ok()).toBeTruthy();
    const sessions = await sessionsRes.json();
    const session = sessions.data.find((s: { assigneeId: string }) => s.assigneeId === assigneeId);
    expect(session).toBeTruthy();

    // Get session detail
    const detailRes = await request.get(`/api/chat-sessions/${session.id}`);
    expect(detailRes.ok()).toBeTruthy();
    const detail = await detailRes.json();
    expect(detail.timezone).toBe("Asia/Tokyo");
  });
});
