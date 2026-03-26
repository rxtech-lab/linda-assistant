import { createClient } from "@libsql/client";
import { test, expect } from "@playwright/test";
import path from "path";
import { taskResponseSchema } from "./helpers/schemas";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

/** Query the session for a given assignee directly from the DB. */
async function getSessionByAssignee(
  assigneeId: string,
): Promise<{ id: string; timezone: string | null } | null> {
  const client = createClient({ url: `file:${dbPath}` });
  const result = await client.execute({
    sql: "SELECT id, timezone FROM chat_sessions WHERE assignee_id = ? ORDER BY created_at DESC LIMIT 1",
    args: [assigneeId],
  });
  client.close();
  if (result.rows.length === 0) return null;
  return {
    id: result.rows[0].id as string,
    timezone: result.rows[0].timezone as string | null,
  };
}

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
    const session = await getSessionByAssignee(assigneeId);
    expect(session).toBeTruthy();
    expect(session!.timezone).toBe("America/New_York");
  });

  test("chat session updates timezone on subsequent messages", async ({ request }) => {
    // Send another message with a different timezone
    const msgRes = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "Hello again", timezone: "Asia/Tokyo" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Verify the timezone was updated
    const session = await getSessionByAssignee(assigneeId);
    expect(session).toBeTruthy();
    expect(session!.timezone).toBe("Asia/Tokyo");
  });

  test("chat session preserves timezone when message omits it", async ({ request }) => {
    // Send a message without timezone
    const msgRes = await request.post(`/api/chat/${assigneeId}/message`, {
      data: { content: "No timezone this time" },
    });
    expect(msgRes.ok()).toBeTruthy();

    // Timezone should still be the previously set value
    const session = await getSessionByAssignee(assigneeId);
    expect(session).toBeTruthy();
    expect(session!.timezone).toBe("Asia/Tokyo");
  });

  test("creating a task with runsAt uses timezone offset as-is", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Scheduled Task with TZ",
        assigneeId,
        runsAt: "2026-06-15T09:00:00+05:30",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    taskResponseSchema.parse(body);
    expect(body.runsAt).toBe("2026-06-15T09:00:00+05:30");
    expect(body.status).toBe("pending");
  });

  test("cron task detail returns nextRunAt in seconds", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "Cron NextRun Task",
        assigneeId,
        cronSchedule: "0 9 * * *",
        isCronEnabled: true,
        timezone: "America/New_York",
      },
    });
    expect(res.status()).toBe(201);
    const created = await res.json();

    const detailRes = await request.get(`/api/tasks/${created.id}`);
    expect(detailRes.ok()).toBeTruthy();
    const detail = await detailRes.json();
    expect(typeof detail.nextRunAt).toBe("number");
    expect(detail.nextRunAt).toBeGreaterThan(0);
    // Daily cron: nextRunAt should be within 24 hours
    expect(detail.nextRunAt).toBeLessThanOrEqual(86400);
  });

  test("non-cron task detail returns null nextRunAt", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "No Cron Task",
        assigneeId,
        runsAt: "2026-12-01T10:00:00+00:00",
      },
    });
    expect(res.status()).toBe(201);
    const created = await res.json();

    const detailRes = await request.get(`/api/tasks/${created.id}`);
    expect(detailRes.ok()).toBeTruthy();
    const detail = await detailRes.json();
    expect(detail.nextRunAt).toBeNull();
  });

  test("list tasks includes nextRunAt for cron tasks", async ({ request }) => {
    // Create a cron task
    const cronRes = await request.post("/api/tasks", {
      data: {
        title: "Cron List NextRun",
        assigneeId,
        cronSchedule: "30 14 * * *",
        isCronEnabled: true,
        timezone: "Europe/London",
      },
    });
    expect(cronRes.status()).toBe(201);
    const cronTask = await cronRes.json();

    const listRes = await request.get("/api/tasks");
    expect(listRes.ok()).toBeTruthy();
    const list = await listRes.json();

    const found = list.data.find((t: any) => t.id === cronTask.id);
    expect(found).toBeTruthy();
    expect(typeof found.nextRunAt).toBe("number");
    expect(found.nextRunAt).toBeGreaterThan(0);
    expect(found.nextRunAt).toBeLessThanOrEqual(86400);
  });

  test("session detail includes timezone field", async ({ request }) => {
    // Get the session for our assignee
    const session = await getSessionByAssignee(assigneeId);
    expect(session).toBeTruthy();

    // Get session detail via API
    const detailRes = await request.get(`/api/chat-sessions/${session!.id}`);
    expect(detailRes.ok()).toBeTruthy();
    const detail = await detailRes.json();
    expect(detail.timezone).toBe("Asia/Tokyo");
  });
});
