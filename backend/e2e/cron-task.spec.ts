import { test, expect } from "@playwright/test";
import { taskResponseSchema } from "./helpers/schemas";

const CELERY_MOCK_URL = "http://localhost:8099";
const CELERY_ADMIN_KEY = "e2e-celery-admin-key";

async function getCeleryCalls(): Promise<Array<{ method: string; path: string; body: unknown }>> {
  const res = await fetch(`${CELERY_MOCK_URL}/_calls`);
  return res.json();
}

async function resetCeleryCalls(): Promise<void> {
  await fetch(`${CELERY_MOCK_URL}/_calls`, { method: "DELETE" });
}

test.describe("Cron Task Scheduling", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: { name: "Cron Test Assignee", email: "cron-test@example.com" },
    });
    expect(res.ok()).toBeTruthy();
    assigneeId = (await res.json()).id;
  });

  test.beforeEach(async () => {
    await resetCeleryCalls();
  });

  test("creating a cron task registers with Celery", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Cron Task",
        description: "A task that runs on a cron schedule",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.cronSchedule).toBe("0 9 * * *");
    expect(body.isCronEnabled).toBe(true);
    expect(body.assigneeId).toBe(assigneeId);

    const calls = await getCeleryCalls();
    const registerCall = calls.find((c) => c.method === "POST" && c.path === "/schedules");
    expect(registerCall).toBeTruthy();
    expect(registerCall?.body).toMatchObject({
      task_id: body.id,
      cron_schedule: "0 9 * * *",
    });
  });

  test("creating a non-cron task does not call Celery", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: { title: "Regular Task", assigneeId },
    });
    expect(res.status()).toBe(201);

    const calls = await getCeleryCalls();
    expect(calls.filter((c) => c.path === "/schedules")).toHaveLength(0);
  });

  test("updating cron schedule calls Celery update", async ({ request }) => {
    // Create task with cron
    const createRes = await request.post("/api/tasks", {
      data: {
        title: "Update Cron Task",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
      },
    });
    const task = await createRes.json();
    await resetCeleryCalls();

    // Update the schedule
    const res = await request.put(`/api/tasks/${task.id}`, {
      data: { cronSchedule: "0 10 * * *" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.cronSchedule).toBe("0 10 * * *");

    const calls = await getCeleryCalls();
    const updateCall = calls.find((c) => c.path === `/schedules/${task.id}`);
    expect(updateCall).toBeTruthy();
    expect(updateCall?.method).toBe("PUT");
    expect(updateCall?.body).toMatchObject({ cron_schedule: "0 10 * * *" });
  });

  test("disabling cron removes Celery entry", async ({ request }) => {
    // Create task with cron
    const createRes = await request.post("/api/tasks", {
      data: {
        title: "Disable Cron Task",
        assigneeId,
        cronSchedule: "* * * * *",
        isCronEnabled: true,
      },
    });
    const task = await createRes.json();
    await resetCeleryCalls();

    // Disable cron
    const res = await request.put(`/api/tasks/${task.id}`, {
      data: { isCronEnabled: false },
    });
    expect(res.ok()).toBeTruthy();

    const calls = await getCeleryCalls();
    const deleteCall = calls.find(
      (c) => c.method === "DELETE" && c.path === `/schedules/${task.id}`,
    );
    expect(deleteCall).toBeTruthy();
  });

  test("deleting a cron task removes Celery entry", async ({ request }) => {
    // Create task with cron
    const createRes = await request.post("/api/tasks", {
      data: {
        title: "Delete Cron Task",
        assigneeId,
        cronSchedule: "* * * * *",
        isCronEnabled: true,
      },
    });
    const task = await createRes.json();
    await resetCeleryCalls();

    const res = await request.delete(`/api/tasks/${task.id}`);
    expect(res.ok()).toBeTruthy();

    const calls = await getCeleryCalls();
    const deleteCall = calls.find(
      (c) => c.method === "DELETE" && c.path === `/schedules/${task.id}`,
    );
    expect(deleteCall).toBeTruthy();
  });

  test("POST /api/tasks/:id/execute creates a chat session", async ({ request }) => {
    // Create task with assignee
    const createRes = await request.post("/api/tasks", {
      data: {
        title: "Execute Test Task",
        description: "Please do the thing",
        assigneeId,
        cronSchedule: "* * * * *",
        isCronEnabled: true,
      },
    });
    const task = await createRes.json();

    // Call execute endpoint with admin key
    const res = await request.post(`/api/tasks/${task.id}/execute`, {
      headers: { authorization: `Bearer ${CELERY_ADMIN_KEY}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.queued).toBe(true);
    expect(body.sessionId).toBeTruthy();

    // Verify the chat session was created and linked to the task
    const taskRes = await request.get(`/api/tasks/${task.id}`);
    const taskBody = await taskRes.json();
    expect(taskBody.chatSessions.length).toBeGreaterThan(0);
    expect(taskBody.chatSessions.some((s: { id: string }) => s.id === body.sessionId)).toBe(true);
  });

  test("execute without assigneeId returns 422", async ({ request }) => {
    // Create task without assignee
    const createRes = await request.post("/api/tasks", {
      data: { title: "No Assignee Task" },
    });
    const task = await createRes.json();

    const res = await request.post(`/api/tasks/${task.id}/execute`, {
      headers: { authorization: `Bearer ${CELERY_ADMIN_KEY}` },
    });
    expect(res.status()).toBe(422);
  });

  test("execute without admin key returns 401", async ({ request }) => {
    const createRes = await request.post("/api/tasks", {
      data: { title: "Auth Test Task", assigneeId },
    });
    const task = await createRes.json();

    const res = await request.post(`/api/tasks/${task.id}/execute`, {
      headers: { authorization: "Bearer wrong-key" },
    });
    expect(res.status()).toBe(401);
  });

  test("execute non-existing task returns 404", async ({ request }) => {
    const res = await request.post("/api/tasks/nonexistent-task-id/execute", {
      headers: { authorization: `Bearer ${CELERY_ADMIN_KEY}` },
    });
    expect(res.status()).toBe(404);
  });

  test("creating a task with invalid cron expression returns 422", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Bad Cron Task",
        assigneeId,
        cronSchedule: "not-a-cron",
        isCronEnabled: true,
      },
    });
    expect(res.status()).toBe(422);
  });

  test("updating a task with invalid cron expression returns 422", async ({ request }) => {
    const createRes = await request.post("/api/tasks", {
      data: { title: "Valid Task For Update", assigneeId },
    });
    expect(createRes.ok()).toBeTruthy();
    const task = await createRes.json();

    const res = await request.put(`/api/tasks/${task.id}`, {
      data: { cronSchedule: "60 * * * *" },
    });
    expect(res.status()).toBe(422);
  });

  test("execute returns 409 when task already has active run", async ({ request }) => {
    const createRes = await request.post("/api/tasks", {
      data: {
        title: "Concurrent Cron Task",
        description: "[SLOW_STREAM] Process this task slowly",
        assigneeId,
        cronSchedule: "* * * * *",
        isCronEnabled: true,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const task = await createRes.json();

    // First execute — creates a session; [SLOW_STREAM] keeps the agent active
    const first = await request.post(`/api/tasks/${task.id}/execute`, {
      headers: { authorization: `Bearer ${CELERY_ADMIN_KEY}` },
    });
    expect(first.ok()).toBeTruthy();

    // Small delay to let the worker pick up the task and set the session active
    await new Promise((r) => setTimeout(r, 500));

    // Second execute while first session is still active — should be skipped
    const second = await request.post(`/api/tasks/${task.id}/execute`, {
      headers: { authorization: `Bearer ${CELERY_ADMIN_KEY}` },
    });
    expect(second.status()).toBe(409);
  });
});
