import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import { ensureOnboarded } from "./onboard.utils";
import { createAssignee, deleteAssignee } from "./chat.utils";
import { TOKEN_FILE, type AuthToken } from "./auth.utils";

const BASE_URL = "http://localhost:3000";

function loadToken(): AuthToken {
  const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as AuthToken;
  if (!data.access_token) throw new Error("No access_token in auth-token.json");
  return data;
}

function authHeaders(token: AuthToken): Record<string, string> {
  return {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
  };
}

const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-tz-${testInfo.testId}`);
    await use(id);
    await deleteAssignee(id);
  },
});

test.describe.serial("Task timezone storage", () => {
  test.setTimeout(30_000);
  let taskId: string;
  let assigneeIdForCleanup: string;

  test("rejects task creation without assignee", async ({ request, assigneeId }) => {
    assigneeIdForCleanup = assigneeId;
    const token = loadToken();
    const res = await request.post(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
      data: {
        title: "No Assignee Task",
      },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("assignee");
  });

  test("creates a scheduled task with timezone", async ({ request, assigneeId }) => {
    const token = loadToken();
    const res = await request.post(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
      data: {
        title: "TZ Test Scheduled",
        assigneeId,
        runsAt: "2026-04-01T09:00:00-05:00",
        timezone: "America/New_York",
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    taskId = body.id;
    expect(body.timezone).toBe("America/New_York");
    expect(body.runsAt).toBe("2026-04-01T09:00:00-05:00");
  });

  test("get task returns stored timezone", async ({ request }) => {
    const token = loadToken();
    const res = await request.get(`${BASE_URL}/api/tasks/${taskId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.timezone).toBe("America/New_York");
  });

  test("update task timezone", async ({ request }) => {
    const token = loadToken();
    const res = await request.put(`${BASE_URL}/api/tasks/${taskId}`, {
      headers: authHeaders(token),
      data: {
        timezone: "Asia/Tokyo",
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.timezone).toBe("Asia/Tokyo");
  });

  test("creates a cron task with timezone", async ({ request, assigneeId }) => {
    const token = loadToken();
    const res = await request.post(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
      data: {
        title: "TZ Test Cron",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "Europe/London",
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.timezone).toBe("Europe/London");
    expect(body.cronSchedule).toBe("0 9 * * *");

    // Verify detail endpoint returns nextRunAt
    const detailRes = await request.get(`${BASE_URL}/api/tasks/${body.id}`, {
      headers: authHeaders(token),
    });
    expect(detailRes.ok()).toBe(true);
    const detail = await detailRes.json();
    expect(detail.nextRunAt).toBeDefined();
    expect(typeof detail.nextRunAt).toBe("number");
    expect(detail.nextRunAt).toBeGreaterThan(0);
    // nextRunAt should be less than 24 hours (86400 seconds) for a daily cron
    expect(detail.nextRunAt).toBeLessThanOrEqual(86400);

    // Cleanup
    await request.delete(`${BASE_URL}/api/tasks/${body.id}`, {
      headers: authHeaders(token),
    });
  });

  test("list tasks includes timezone and nextRunAt for cron", async ({ request, assigneeId }) => {
    const token = loadToken();

    // Create a cron task to verify nextRunAt in list
    const cronRes = await request.post(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
      data: {
        title: "TZ List Cron",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "America/Chicago",
      },
    });
    expect(cronRes.ok()).toBe(true);
    const cronTask = await cronRes.json();

    const res = await request.get(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();

    // Verify the scheduled (non-cron) task
    const scheduledTask = body.data.find((t: any) => t.id === taskId);
    expect(scheduledTask).toBeDefined();
    expect(scheduledTask.timezone).toBe("Asia/Tokyo");
    // Non-cron tasks should have null nextRunAt in list
    expect(scheduledTask.nextRunAt).toBeNull();

    // Verify the cron task has nextRunAt in list
    const cronInList = body.data.find((t: any) => t.id === cronTask.id);
    expect(cronInList).toBeDefined();
    expect(cronInList.nextRunAt).toBeDefined();
    expect(typeof cronInList.nextRunAt).toBe("number");
    expect(cronInList.nextRunAt).toBeGreaterThan(0);
    expect(cronInList.nextRunAt).toBeLessThanOrEqual(86400);

    // Cleanup cron task
    await request.delete(`${BASE_URL}/api/tasks/${cronTask.id}`, {
      headers: authHeaders(token),
    });
  });

  test("scheduled task detail has null nextRunAt", async ({ request }) => {
    const token = loadToken();
    const res = await request.get(`${BASE_URL}/api/tasks/${taskId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    // runsAt task (non-cron) should not have nextRunAt
    expect(body.nextRunAt).toBeNull();
  });

  test("rejects cron task with empty cron expression", async ({ request, assigneeId }) => {
    const token = loadToken();
    const res = await request.post(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
      data: {
        title: "Empty Cron Task",
        assigneeId,
        cronSchedule: "",
        isCronEnabled: true,
      },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(422);
  });

  test.afterAll(async ({ request }) => {
    if (taskId) {
      const token = loadToken();
      await request.delete(`${BASE_URL}/api/tasks/${taskId}`, {
        headers: authHeaders(token),
      });
    }
  });
});
