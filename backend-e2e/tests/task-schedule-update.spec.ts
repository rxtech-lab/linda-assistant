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

interface CelerySchedule {
  taskId: string;
  cronSchedule: string | null;
  timezone: string | null;
  registered: boolean;
}

async function getCelerySchedule(
  request: import("@playwright/test").APIRequestContext,
  token: AuthToken,
  taskId: string,
): Promise<CelerySchedule> {
  const res = await request.get(`${BASE_URL}/api/tasks/${taskId}/celery-schedule`, {
    headers: authHeaders(token),
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as CelerySchedule;
}

const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-schedsync-${testInfo.testId}`);
    await use(id);
    await deleteAssignee(id);
  },
});

test.describe("Task schedule updates sync with Celery", () => {
  test.setTimeout(30_000);

  // These tests hit Celery's real GET /schedules/:id via the backend proxy at
  // /api/tasks/:id/celery-schedule. That proves the DB and Celery agree after
  // each PUT — the exact invariant that the original bug broke.

  test("enabling cron on a previously non-cron task registers with Celery", async ({
    request,
    assigneeId,
  }) => {
    const token = loadToken();

    const createRes = await request.post(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
      data: {
        assigneeId,
        title: "Regression — enable cron via PUT",
        description: "Say hello and stop.",
      },
    });
    expect(createRes.ok()).toBe(true);
    const task = (await createRes.json()) as { id: string };

    try {
      // Sanity: Celery should know nothing about this task yet.
      const before = await getCelerySchedule(request, loadToken(), task.id);
      expect(before.registered).toBe(false);

      // Use a cron that will not fire during the test window.
      const updateRes = await request.put(`${BASE_URL}/api/tasks/${task.id}`, {
        headers: authHeaders(token),
        data: {
          cronSchedule: "0 0 1 1 *",
          isCronEnabled: true,
          timezone: "UTC",
        },
      });
      expect(updateRes.ok()).toBe(true);

      const after = await getCelerySchedule(request, loadToken(), task.id);
      expect(after.registered).toBe(true);
      expect(after.cronSchedule).toBe("0 0 1 1 *");
      expect(after.timezone).toBe("UTC");
    } finally {
      await request.delete(`${BASE_URL}/api/tasks/${task.id}`, {
        headers: authHeaders(token),
      });
    }
  });

  test("updating timezone only on a cron task propagates to Celery", async ({
    request,
    assigneeId,
  }) => {
    const token = loadToken();

    const createRes = await request.post(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
      data: {
        assigneeId,
        title: "Regression — timezone only update",
        description: "Say hello and stop.",
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "UTC",
      },
    });
    expect(createRes.ok()).toBe(true);
    const task = (await createRes.json()) as { id: string };

    try {
      const initial = await getCelerySchedule(request, loadToken(), task.id);
      expect(initial.registered).toBe(true);
      expect(initial.timezone).toBe("UTC");

      const updateRes = await request.put(`${BASE_URL}/api/tasks/${task.id}`, {
        headers: authHeaders(token),
        data: { timezone: "America/Los_Angeles" },
      });
      expect(updateRes.ok()).toBe(true);

      const after = await getCelerySchedule(request, loadToken(), task.id);
      expect(after.registered).toBe(true);
      // Celery must reflect the new timezone — pre-fix, this stayed "UTC"
      // because the backend hit the wrong endpoint on Celery.
      expect(after.timezone).toBe("America/Los_Angeles");
      // And the cron must stay intact.
      expect(after.cronSchedule).toBe("0 9 * * *");
    } finally {
      await request.delete(`${BASE_URL}/api/tasks/${task.id}`, {
        headers: authHeaders(token),
      });
    }
  });

  test("updating cron schedule only propagates to Celery", async ({
    request,
    assigneeId,
  }) => {
    const token = loadToken();

    const createRes = await request.post(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
      data: {
        assigneeId,
        title: "Regression — cron-only update",
        description: "Say hello and stop.",
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "America/New_York",
      },
    });
    expect(createRes.ok()).toBe(true);
    const task = (await createRes.json()) as { id: string };

    try {
      const updateRes = await request.put(`${BASE_URL}/api/tasks/${task.id}`, {
        headers: authHeaders(token),
        data: { cronSchedule: "30 14 * * *" },
      });
      expect(updateRes.ok()).toBe(true);

      const after = await getCelerySchedule(request, loadToken(), task.id);
      expect(after.registered).toBe(true);
      expect(after.cronSchedule).toBe("30 14 * * *");
      expect(after.timezone).toBe("America/New_York");
    } finally {
      await request.delete(`${BASE_URL}/api/tasks/${task.id}`, {
        headers: authHeaders(token),
      });
    }
  });

  test("disabling cron unregisters from Celery", async ({ request, assigneeId }) => {
    const token = loadToken();

    const createRes = await request.post(`${BASE_URL}/api/tasks`, {
      headers: authHeaders(token),
      data: {
        assigneeId,
        title: "Regression — disable cron",
        description: "Say hello and stop.",
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "UTC",
      },
    });
    expect(createRes.ok()).toBe(true);
    const task = (await createRes.json()) as { id: string };

    try {
      expect((await getCelerySchedule(request, loadToken(), task.id)).registered).toBe(true);

      const updateRes = await request.put(`${BASE_URL}/api/tasks/${task.id}`, {
        headers: authHeaders(token),
        data: { isCronEnabled: false },
      });
      expect(updateRes.ok()).toBe(true);

      const after = await getCelerySchedule(request, loadToken(), task.id);
      expect(after.registered).toBe(false);
    } finally {
      await request.delete(`${BASE_URL}/api/tasks/${task.id}`, {
        headers: authHeaders(token),
      });
    }
  });
});
