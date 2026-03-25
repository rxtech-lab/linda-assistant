import { test, expect } from "@playwright/test";
import {
  taskResponseSchema,
  taskListResponseSchema,
  taskDetailResponseSchema,
  taskSessionsResponseSchema,
  deleteResponseSchema,
  errorResponseSchema,
} from "./helpers/schemas";

const user2Headers = { "x-test-user-id": "e2e-user-2" };

test.describe("Tasks CRUD", () => {
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Test Task",
        description: "A test task description",
        tags: ["test", "e2e"],
        categories: ["testing"],
      },
    });
    const body = await res.json();
    taskId = body.id;
  });

  test("POST /api/tasks creates a task with pending status", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Creation Test Task",
        description: "Testing creation",
        tags: ["create"],
        categories: ["test"],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body).toMatchObject({
      title: "Creation Test Task",
      description: "Testing creation",
      tags: ["create"],
      categories: ["test"],
    });
    expect(body.status).toBe("pending");
    expect(body.id).toBeTruthy();
    expect(body.userId).toBe("e2e-test-user");
  });

  test("POST /api/tasks with cron enabled defaults to pending status", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Cron Default Task",
        isCronEnabled: true,
        cronSchedule: "0 9 * * *",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("pending");
  });

  test("GET /api/tasks lists tasks with pagination", async ({ request }) => {
    const res = await request.get("/api/tasks");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    taskListResponseSchema.parse(body);
    expect(body.pagination).toMatchObject({
      total: expect.any(Number),
      limit: expect.any(Number),
      offset: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    const found = body.data.find((t: { id: string }) => t.id === taskId);
    expect(found).toBeTruthy();
  });

  test("GET /api/tasks/:id returns task with relations", async ({ request }) => {
    const res = await request.get(`/api/tasks/${taskId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    taskDetailResponseSchema.parse(body);
    expect(body.id).toBe(taskId);
    expect(body.title).toBe("Test Task");
    expect(body.chatSessions).toEqual([]);
    expect(body.emails).toEqual([]);
  });

  test("PUT /api/tasks/:id updates and preserves unchanged fields", async ({ request }) => {
    const res = await request.put(`/api/tasks/${taskId}`, {
      data: { title: "Updated Task" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.title).toBe("Updated Task");
    expect(body.description).toBe("A test task description");
    expect(body.tags).toEqual(["test", "e2e"]);
  });

  test("POST /api/tasks/:id/stop sets status to stopped", async ({ request }) => {
    const res = await request.post(`/api/tasks/${taskId}/stop`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.status).toBe("stopped");
    expect(body.id).toBe(taskId);
  });

  test("POST /api/tasks/:id/start sets status to pending", async ({ request }) => {
    const res = await request.post(`/api/tasks/${taskId}/start`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.status).toBe("pending");
    expect(body.id).toBe(taskId);
  });

  test("DELETE /api/tasks/:id removes the task", async ({ request }) => {
    const res = await request.delete(`/api/tasks/${taskId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    deleteResponseSchema.parse(body);
    expect(body.deleted).toBe(true);

    const getRes = await request.get(`/api/tasks/${taskId}`);
    expect(getRes.status()).toBe(404);
  });
});

test.describe("Tasks start/stop non-existing resource", () => {
  const fakeId = "nonexistent-task-12345";

  test("start non-existing task returns 404", async ({ request }) => {
    const res = await request.post(`/api/tasks/${fakeId}/start`);
    expect(res.status()).toBe(404);
  });

  test("stop non-existing task returns 404", async ({ request }) => {
    const res = await request.post(`/api/tasks/${fakeId}/stop`);
    expect(res.status()).toBe(404);
  });
});

test.describe("Tasks cross-user isolation", () => {
  let user1TaskId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: { title: "User1 Task" },
    });
    const body = await res.json();
    user1TaskId = body.id;
  });

  test("user2 cannot list user1 tasks", async ({ request }) => {
    const res = await request.get("/api/tasks", { headers: user2Headers });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const found = body.data.find((t: { id: string }) => t.id === user1TaskId);
    expect(found).toBeUndefined();
  });

  test("user2 cannot GET user1 task", async ({ request }) => {
    const res = await request.get(`/api/tasks/${user1TaskId}`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });

  test("user2 cannot PUT user1 task", async ({ request }) => {
    const res = await request.put(`/api/tasks/${user1TaskId}`, {
      headers: user2Headers,
      data: { title: "Hacked" },
    });
    expect(res.status()).toBe(404);

    const getRes = await request.get(`/api/tasks/${user1TaskId}`);
    const body = await getRes.json();
    expect(body.title).toBe("User1 Task");
  });

  test("user2 cannot DELETE user1 task", async ({ request }) => {
    const res = await request.delete(`/api/tasks/${user1TaskId}`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);

    const getRes = await request.get(`/api/tasks/${user1TaskId}`);
    expect(getRes.ok()).toBeTruthy();
  });

  test("user2 cannot start user1 task", async ({ request }) => {
    const res = await request.post(`/api/tasks/${user1TaskId}/start`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });

  test("user2 cannot stop user1 task", async ({ request }) => {
    const res = await request.post(`/api/tasks/${user1TaskId}/stop`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Tasks non-existing resource", () => {
  const fakeId = "nonexistent-task-12345";

  test("GET non-existing task returns 404", async ({ request }) => {
    const res = await request.get(`/api/tasks/${fakeId}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Task not found");
  });

  test("PUT non-existing task returns 404", async ({ request }) => {
    const res = await request.put(`/api/tasks/${fakeId}`, {
      data: { title: "Ghost" },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Task not found");
  });

  test("DELETE non-existing task returns 404", async ({ request }) => {
    const res = await request.delete(`/api/tasks/${fakeId}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Task not found");
  });
});

test.describe("Tasks partial update", () => {
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Partial Task",
        description: "Original description",
        tags: ["original"],
        categories: ["cat1"],
      },
    });
    const body = await res.json();
    taskId = body.id;
  });

  test("update only title preserves other fields", async ({ request }) => {
    const res = await request.put(`/api/tasks/${taskId}`, {
      data: { title: "New Title" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.title).toBe("New Title");
    expect(body.description).toBe("Original description");
    expect(body.tags).toEqual(["original"]);
  });

  test("update tags array replaces entirely", async ({ request }) => {
    const res = await request.put(`/api/tasks/${taskId}`, {
      data: { tags: ["new-tag-1", "new-tag-2"] },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.tags).toEqual(["new-tag-1", "new-tag-2"]);
    expect(body.title).toBe("New Title");
  });

  test("empty body is valid and changes nothing", async ({ request }) => {
    const before = await request.get(`/api/tasks/${taskId}`);
    const beforeBody = await before.json();

    const res = await request.put(`/api/tasks/${taskId}`, { data: {} });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.title).toBe(beforeBody.title);
    expect(body.status).toBe(beforeBody.status);
  });
});

test.describe("Task chat sessions relationship", () => {
  let taskId: string;
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    // Create assignee for sessions
    const assigneeRes = await request.post("/api/assignees", {
      data: { name: "Task Assignee", email: "task-assignee@example.com" },
    });
    const assigneeBody = await assigneeRes.json();
    assigneeId = assigneeBody.id;

    // Create task
    const taskRes = await request.post("/api/tasks", {
      data: { title: "Task With Sessions" },
    });
    const taskBody = await taskRes.json();
    taskId = taskBody.id;
  });

  test("GET /api/tasks/:id/chat-sessions returns empty initially", async ({ request }) => {
    const res = await request.get(`/api/tasks/${taskId}/chat-sessions`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.pagination).toBeTruthy();
  });

  test("chat sessions linked to task appear in response", async ({ request }) => {
    // Create a session linked to the task
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId, taskId },
    });
    expect(sessionRes.status()).toBe(201);
    const sessionBody = await sessionRes.json();

    // Check task detail includes the session
    const taskRes = await request.get(`/api/tasks/${taskId}`);
    const taskBody = await taskRes.json();
    taskDetailResponseSchema.parse(taskBody);
    expect(taskBody.chatSessions).toHaveLength(1);
    expect(taskBody.chatSessions[0].id).toBe(sessionBody.id);

    // Also check the dedicated endpoint
    const sessionsRes = await request.get(`/api/tasks/${taskId}/chat-sessions`);
    const sessionsBody = await sessionsRes.json();
    expect(sessionsBody.data).toHaveLength(1);
    expect(sessionsBody.data[0].id).toBe(sessionBody.id);
  });

  test("user2 cannot access task chat sessions", async ({ request }) => {
    const res = await request.get(`/api/tasks/${taskId}/chat-sessions`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Task tool permissions validation", () => {
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: { title: "Tool Perms Task" },
    });
    const body = await res.json();
    taskId = body.id;
  });

  test("PUT rejects permission change for system tools", async ({ request }) => {
    const systemTools = [
      "update_document",
      "create_document",
      "search_documents",
      "create_briefing",
      "send_notification",
    ];
    for (const toolName of systemTools) {
      const res = await request.put(`/api/tasks/${taskId}`, {
        data: {
          toolPermissions: [{ toolName, permission: "disabled" }],
        },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      errorResponseSchema.parse(body);
      expect(body.error).toContain("Cannot change permissions for system tools");
      expect(body.error).toContain(toolName);
    }
  });

  test("PUT allows permission change for regular tools", async ({ request }) => {
    const res = await request.put(`/api/tasks/${taskId}`, {
      data: {
        toolPermissions: [{ toolName: "send_email", permission: "auto-confirm" }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.toolPermissions).toEqual([{ toolName: "send_email", permission: "auto-confirm" }]);
  });
});
