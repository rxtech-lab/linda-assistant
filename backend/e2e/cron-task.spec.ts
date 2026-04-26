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

  test("creating a cron task with timezone passes timezone to Celery", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Cron Task with TZ",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "Asia/Tokyo",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.cronSchedule).toBe("0 9 * * *");
    expect(body.timezone).toBe("Asia/Tokyo");

    const calls = await getCeleryCalls();
    const registerCall = calls.find((c) => c.method === "POST" && c.path === "/schedules");
    expect(registerCall).toBeTruthy();
    expect(registerCall?.body).toMatchObject({
      task_id: body.id,
      cron_schedule: "0 9 * * *",
      timezone: "Asia/Tokyo",
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
        timezone: "America/New_York",
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
    expect(updateCall?.body).toMatchObject({
      cron_schedule: "0 10 * * *",
      timezone: "America/New_York",
    });
  });

  test("updating only timezone on cron task calls Celery PUT (not POST)", async ({ request }) => {
    // Create task with cron
    const createRes = await request.post("/api/tasks", {
      data: {
        title: "Timezone Update Task",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "America/New_York",
      },
    });
    const task = await createRes.json();
    await resetCeleryCalls();

    // Update only timezone — cronSchedule is not in the payload
    const res = await request.put(`/api/tasks/${task.id}`, {
      data: { timezone: "Asia/Tokyo" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.timezone).toBe("Asia/Tokyo");
    expect(body.cronSchedule).toBe("0 9 * * *");

    const calls = await getCeleryCalls();
    // Should have called PUT /schedules/:id with the new timezone,
    // not POST /schedules (which would try to re-register an existing task).
    const updateCall = calls.find(
      (c) => c.method === "PUT" && c.path === `/schedules/${task.id}`,
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall?.body).toMatchObject({
      cron_schedule: "0 9 * * *",
      timezone: "Asia/Tokyo",
    });

    const registerCall = calls.find((c) => c.method === "POST" && c.path === "/schedules");
    expect(registerCall).toBeFalsy();
  });

  test("updating non-scheduling fields on cron task does not call Celery", async ({ request }) => {
    const createRes = await request.post("/api/tasks", {
      data: {
        title: "Title Only Update Task",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "America/New_York",
      },
    });
    const task = await createRes.json();
    await resetCeleryCalls();

    // Update only title — no scheduling fields
    const res = await request.put(`/api/tasks/${task.id}`, {
      data: { title: "Renamed Task" },
    });
    expect(res.ok()).toBeTruthy();

    const calls = await getCeleryCalls();
    const scheduleCalls = calls.filter(
      (c) => c.path === "/schedules" || c.path === `/schedules/${task.id}`,
    );
    expect(scheduleCalls).toHaveLength(0);
  });

  test("enabling cron on a previously non-cron task calls Celery POST (register)", async ({
    request,
  }) => {
    // Create task without cron
    const createRes = await request.post("/api/tasks", {
      data: { title: "Enable Cron Later Task", assigneeId },
    });
    const task = await createRes.json();
    await resetCeleryCalls();

    // Now add cron via update
    const res = await request.put(`/api/tasks/${task.id}`, {
      data: {
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "Europe/London",
      },
    });
    expect(res.ok()).toBeTruthy();

    const calls = await getCeleryCalls();
    // Should be a fresh registration (POST), not an update (PUT) of a non-existent entry.
    const registerCall = calls.find((c) => c.method === "POST" && c.path === "/schedules");
    expect(registerCall).toBeTruthy();
    expect(registerCall?.body).toMatchObject({
      task_id: task.id,
      cron_schedule: "0 9 * * *",
      timezone: "Europe/London",
    });

    const updateCall = calls.find(
      (c) => c.method === "PUT" && c.path === `/schedules/${task.id}`,
    );
    expect(updateCall).toBeFalsy();
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

  test("switching from scheduled (runsAt) to none clears schedule fields", async ({ request }) => {
    // Create task with runsAt schedule
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const createRes = await request.post("/api/tasks", {
      data: {
        title: "Scheduled To None Task",
        assigneeId,
        runsAt: futureDate,
        timezone: "America/New_York",
      },
    });
    expect(createRes.status()).toBe(201);
    const task = await createRes.json();
    expect(task.runsAt).toBeTruthy();
    expect(task.timezone).toBe("America/New_York");

    // Switch to none — iOS sends only isCronEnabled: false (runsAt omitted = undefined)
    const res = await request.put(`/api/tasks/${task.id}`, {
      data: { isCronEnabled: false },
    });
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.runsAt).toBeNull();
    expect(updated.cronSchedule).toBeNull();
    expect(updated.timezone).toBeNull();
    expect(updated.isCronEnabled).toBe(false);
  });

  test("switching from cron to none clears all schedule fields", async ({ request }) => {
    // Create task with cron
    const createRes = await request.post("/api/tasks", {
      data: {
        title: "Cron To None Task",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "Europe/London",
      },
    });
    expect(createRes.status()).toBe(201);
    const task = await createRes.json();
    expect(task.isCronEnabled).toBe(true);
    expect(task.cronSchedule).toBe("0 9 * * *");
    await resetCeleryCalls();

    // Switch to none
    const res = await request.put(`/api/tasks/${task.id}`, {
      data: { isCronEnabled: false },
    });
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.runsAt).toBeNull();
    expect(updated.cronSchedule).toBeNull();
    expect(updated.timezone).toBeNull();
    expect(updated.isCronEnabled).toBe(false);

    // Verify Celery delete was called
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

  test("creating a task without assignee returns 422", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: { title: "No Assignee Task" },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("assignee");
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

  test("creating a cron task with empty cron expression returns 422", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Empty Cron Task",
        assigneeId,
        cronSchedule: "",
        isCronEnabled: true,
      },
    });
    expect(res.status()).toBe(422);
  });

  test("creating a cron task with whitespace-only cron expression returns 422", async ({
    request,
  }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Whitespace Cron Task",
        assigneeId,
        cronSchedule: "   ",
        isCronEnabled: true,
      },
    });
    expect(res.status()).toBe(422);
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

  test("GET /api/tasks/:id/celery-schedule reflects Celery's current state", async ({
    request,
  }) => {
    // Unregistered: non-cron task should report registered:false
    const nonCronRes = await request.post("/api/tasks", {
      data: { title: "Celery View Non-Cron", assigneeId },
    });
    const nonCronTask = await nonCronRes.json();
    const nonCronView = await request.get(
      `/api/tasks/${nonCronTask.id}/celery-schedule`,
    );
    expect(nonCronView.ok()).toBeTruthy();
    expect(await nonCronView.json()).toMatchObject({
      taskId: nonCronTask.id,
      cronSchedule: null,
      timezone: null,
      registered: false,
    });

    // Registered: cron task should surface Celery's stored cron + timezone
    const cronRes = await request.post("/api/tasks", {
      data: {
        title: "Celery View Cron",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "Europe/London",
      },
    });
    const cronTask = await cronRes.json();
    const cronView = await request.get(`/api/tasks/${cronTask.id}/celery-schedule`);
    expect(cronView.ok()).toBeTruthy();
    expect(await cronView.json()).toMatchObject({
      taskId: cronTask.id,
      cronSchedule: "0 9 * * *",
      timezone: "Europe/London",
      registered: true,
    });

    // After a timezone-only update, Celery's view tracks the new timezone
    await request.put(`/api/tasks/${cronTask.id}`, {
      data: { timezone: "Asia/Tokyo" },
    });
    const updatedView = await request.get(
      `/api/tasks/${cronTask.id}/celery-schedule`,
    );
    expect(await updatedView.json()).toMatchObject({
      taskId: cronTask.id,
      cronSchedule: "0 9 * * *",
      timezone: "Asia/Tokyo",
      registered: true,
    });
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
