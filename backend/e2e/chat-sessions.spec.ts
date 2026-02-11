import { test, expect } from "@playwright/test";
import {
  chatSessionResponseSchema,
  chatSessionListResponseSchema,
  deleteResponseSchema,
  errorResponseSchema,
} from "./helpers/schemas";

const user2Headers = { "x-test-user-id": "e2e-user-2" };

test.describe("Chat Sessions CRUD", () => {
  let assigneeId: string;
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: { name: "Session Assignee", email: "session@example.com" },
    });
    const body = await res.json();
    assigneeId = body.id;
  });

  test("POST /api/chat-sessions creates a session", async ({ request }) => {
    const res = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    chatSessionResponseSchema.parse(body);
    expect(body.assigneeId).toBe(assigneeId);
    expect(body.userId).toBe("e2e-test-user");
    expect(body.status).toBe("starting");
    expect(body.messages).toEqual([]);
    expect(body.id).toBeTruthy();
    sessionId = body.id;
  });

  test("POST /api/chat-sessions with title", async ({ request }) => {
    const res = await request.post("/api/chat-sessions", {
      data: { assigneeId, title: "My Chat" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    chatSessionResponseSchema.parse(body);
    expect(body.title).toBe("My Chat");
  });

  test("GET /api/chat-sessions lists sessions with pagination", async ({ request }) => {
    const res = await request.get("/api/chat-sessions");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    chatSessionListResponseSchema.parse(body);
    expect(body.pagination).toMatchObject({
      total: expect.any(Number),
      limit: expect.any(Number),
      offset: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    // List omits messages
    const found = body.data.find((s: { id: string }) => s.id === sessionId);
    expect(found).toBeTruthy();
    expect(found).not.toHaveProperty("messages");
  });

  test("GET /api/chat-sessions/:id returns session with messages", async ({ request }) => {
    const res = await request.get(`/api/chat-sessions/${sessionId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    chatSessionResponseSchema.parse(body);
    expect(body.id).toBe(sessionId);
    expect(body.messages).toEqual([]);
    expect(body.assigneeId).toBe(assigneeId);
  });

  test("DELETE /api/chat-sessions/:id removes the session", async ({ request }) => {
    const res = await request.delete(`/api/chat-sessions/${sessionId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    deleteResponseSchema.parse(body);
    expect(body.deleted).toBe(true);

    const getRes = await request.get(`/api/chat-sessions/${sessionId}`);
    expect(getRes.status()).toBe(404);
  });
});

test.describe("Chat Sessions cross-user isolation", () => {
  let user1SessionId: string;

  test.beforeAll(async ({ request }) => {
    const assigneeRes = await request.post("/api/assignees", {
      data: { name: "Isolation Assignee", email: "isolation@example.com" },
    });
    const assigneeBody = await assigneeRes.json();

    const res = await request.post("/api/chat-sessions", {
      data: { assigneeId: assigneeBody.id },
    });
    const body = await res.json();
    user1SessionId = body.id;
  });

  test("user2 cannot list user1 sessions", async ({ request }) => {
    const res = await request.get("/api/chat-sessions", {
      headers: user2Headers,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const found = body.data.find((s: { id: string }) => s.id === user1SessionId);
    expect(found).toBeUndefined();
  });

  test("user2 cannot GET user1 session", async ({ request }) => {
    const res = await request.get(`/api/chat-sessions/${user1SessionId}`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });

  test("user2 cannot DELETE user1 session", async ({ request }) => {
    const res = await request.delete(`/api/chat-sessions/${user1SessionId}`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);

    // Still exists for user1
    const getRes = await request.get(`/api/chat-sessions/${user1SessionId}`);
    expect(getRes.ok()).toBeTruthy();
  });

  test("user2 cannot POST message to user1 session", async ({ request }) => {
    const res = await request.post(`/api/chat-sessions/${user1SessionId}/messages`, {
      headers: user2Headers,
      data: { content: "Trying to inject message" },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Chat Sessions non-existing resource", () => {
  const fakeId = "nonexistent-session-12345";

  test("GET non-existing session returns 404", async ({ request }) => {
    const res = await request.get(`/api/chat-sessions/${fakeId}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Chat session not found");
  });

  test("DELETE non-existing session returns 404", async ({ request }) => {
    const res = await request.delete(`/api/chat-sessions/${fakeId}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Chat session not found");
  });

  test("POST message to non-existing session returns 404", async ({ request }) => {
    const res = await request.post(`/api/chat-sessions/${fakeId}/messages`, {
      data: { content: "Hello" },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Chat session not found");
  });
});
