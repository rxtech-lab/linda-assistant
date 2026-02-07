import { test, expect } from "@playwright/test";
import {
  assigneeResponseSchema,
  assigneeListResponseSchema,
  deleteResponseSchema,
  errorResponseSchema,
} from "./helpers/schemas";
import { AVAILABLE_MODEL_IDS } from "../lib/ai/models";

const TEST_MODEL = AVAILABLE_MODEL_IDS[0];

const user2Headers = { "x-test-user-id": "e2e-user-2" };

test.describe("Assignees CRUD", () => {
  let assigneeId: string;

  test("POST /api/assignees creates an assignee", async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Test Assistant",
        email: "test@example.com",
        personality: "Friendly helper",
        model: TEST_MODEL,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body).toMatchObject({
      name: "Test Assistant",
      email: "test@example.com",
      personality: "Friendly helper",
      model: TEST_MODEL,
    });
    expect(body.id).toBeTruthy();
    expect(body.userId).toBe("e2e-test-user");
    assigneeId = body.id;
  });

  test("GET /api/assignees lists assignees with pagination", async ({
    request,
  }) => {
    const res = await request.get("/api/assignees");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeListResponseSchema.parse(body);
    expect(body.pagination).toMatchObject({
      total: expect.any(Number),
      limit: expect.any(Number),
      offset: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    const found = body.data.find(
      (a: { id: string }) => a.id === assigneeId
    );
    expect(found).toBeTruthy();
  });

  test("GET /api/assignees/:id returns a single assignee", async ({
    request,
  }) => {
    const res = await request.get(`/api/assignees/${assigneeId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.id).toBe(assigneeId);
    expect(body.name).toBe("Test Assistant");
  });

  test("PUT /api/assignees/:id updates and preserves unchanged fields", async ({
    request,
  }) => {
    const res = await request.put(`/api/assignees/${assigneeId}`, {
      data: { name: "Updated Assistant", email: "updated@example.com" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.name).toBe("Updated Assistant");
    expect(body.email).toBe("updated@example.com");
    // Unchanged fields persist
    expect(body.personality).toBe("Friendly helper");
    expect(body.model).toBe(TEST_MODEL);
  });

  test("DELETE /api/assignees/:id removes the assignee", async ({
    request,
  }) => {
    const res = await request.delete(`/api/assignees/${assigneeId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    deleteResponseSchema.parse(body);
    expect(body.deleted).toBe(true);

    // Subsequent GET returns 404
    const getRes = await request.get(`/api/assignees/${assigneeId}`);
    expect(getRes.status()).toBe(404);
  });
});

test.describe("Cross-user isolation", () => {
  let user1AssigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: { name: "User1 Assistant", email: "user1@example.com" },
    });
    const body = await res.json();
    user1AssigneeId = body.id;
  });

  test("user2 cannot list user1 assignees", async ({ request }) => {
    const res = await request.get("/api/assignees", {
      headers: user2Headers,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const found = body.data.find(
      (a: { id: string }) => a.id === user1AssigneeId
    );
    expect(found).toBeUndefined();
  });

  test("user2 cannot GET user1 assignee", async ({ request }) => {
    const res = await request.get(`/api/assignees/${user1AssigneeId}`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });

  test("user2 cannot PUT user1 assignee", async ({ request }) => {
    const res = await request.put(`/api/assignees/${user1AssigneeId}`, {
      headers: user2Headers,
      data: { name: "Hacked Name" },
    });
    expect(res.status()).toBe(404);

    // Verify user1's data is unchanged
    const getRes = await request.get(`/api/assignees/${user1AssigneeId}`);
    const body = await getRes.json();
    expect(body.name).toBe("User1 Assistant");
  });

  test("user2 cannot DELETE user1 assignee", async ({ request }) => {
    const res = await request.delete(`/api/assignees/${user1AssigneeId}`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);

    // Still exists for user1
    const getRes = await request.get(`/api/assignees/${user1AssigneeId}`);
    expect(getRes.ok()).toBeTruthy();
  });

  test("user2 can create own assignee, invisible to user1", async ({
    request,
  }) => {
    const createRes = await request.post("/api/assignees", {
      headers: user2Headers,
      data: { name: "User2 Assistant", email: "user2@example.com" },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.userId).toBe("e2e-user-2");

    // User1 cannot see it
    const listRes = await request.get("/api/assignees");
    const listBody = await listRes.json();
    const found = listBody.data.find(
      (a: { id: string }) => a.id === created.id
    );
    expect(found).toBeUndefined();
  });
});

test.describe("Non-existing resource", () => {
  const fakeId = "nonexistent-id-12345";

  test("GET non-existing assignee returns 404", async ({ request }) => {
    const res = await request.get(`/api/assignees/${fakeId}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Assignee not found");
  });

  test("PUT non-existing assignee returns 404", async ({ request }) => {
    const res = await request.put(`/api/assignees/${fakeId}`, {
      data: { name: "Ghost" },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Assignee not found");
  });

  test("DELETE non-existing assignee returns 404", async ({ request }) => {
    const res = await request.delete(`/api/assignees/${fakeId}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Assignee not found");
  });
});

test.describe("Partial update", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Partial Test",
        email: "partial@example.com",
        personality: "Calm and collected",
        model: TEST_MODEL,
      },
    });
    const body = await res.json();
    assigneeId = body.id;
  });

  test("update only name preserves other fields", async ({ request }) => {
    const res = await request.put(`/api/assignees/${assigneeId}`, {
      data: { name: "New Name" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.name).toBe("New Name");
    expect(body.email).toBe("partial@example.com");
    expect(body.personality).toBe("Calm and collected");
    expect(body.model).toBe(TEST_MODEL);
  });

  test("update only email preserves other fields", async ({ request }) => {
    const res = await request.put(`/api/assignees/${assigneeId}`, {
      data: { email: "new-email@example.com" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.email).toBe("new-email@example.com");
    expect(body.name).toBe("New Name");
    expect(body.personality).toBe("Calm and collected");
    expect(body.model).toBe(TEST_MODEL);
  });

  test("update only personality preserves other fields", async ({
    request,
  }) => {
    const res = await request.put(`/api/assignees/${assigneeId}`, {
      data: { personality: "Bold and brave" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.personality).toBe("Bold and brave");
    expect(body.name).toBe("New Name");
    expect(body.email).toBe("new-email@example.com");
    expect(body.model).toBe(TEST_MODEL);
  });

  test("empty body is valid and changes nothing", async ({ request }) => {
    const before = await request.get(`/api/assignees/${assigneeId}`);
    const beforeBody = await before.json();

    const res = await request.put(`/api/assignees/${assigneeId}`, {
      data: {},
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.name).toBe(beforeBody.name);
    expect(body.email).toBe(beforeBody.email);
    expect(body.personality).toBe(beforeBody.personality);
    expect(body.model).toBe(beforeBody.model);
  });
});

test.describe("Tool permissions", () => {
  let assigneeId: string;

  const permissions = [
    { toolName: "send_email", permission: "auto-confirm" as const },
    { toolName: "create_task", permission: "manual-confirm" as const },
  ];

  test("create with toolPermissions", async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Permissions Test",
        email: "perms@example.com",
        toolPermissions: permissions,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.toolPermissions).toEqual(permissions);
    assigneeId = body.id;
  });

  test("GET returns correct permissions", async ({ request }) => {
    const res = await request.get(`/api/assignees/${assigneeId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.toolPermissions).toEqual(permissions);
  });

  test("PUT replaces entire permissions array", async ({ request }) => {
    const newPermissions = [
      { toolName: "search_emails", permission: "auto-confirm" as const },
    ];
    const res = await request.put(`/api/assignees/${assigneeId}`, {
      data: { toolPermissions: newPermissions },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.toolPermissions).toEqual(newPermissions);
    // Name unchanged
    expect(body.name).toBe("Permissions Test");
  });

  test("create without permissions defaults to null", async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "No Perms",
        email: "noperms@example.com",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    expect(body.toolPermissions).toBeNull();
  });
});
