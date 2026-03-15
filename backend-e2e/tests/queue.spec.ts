import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  updateAssigneePermissions,
  consumeStream,
} from "./chat.utils";
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

// Fixture: each test gets its own assignee with create_document auto-confirmed
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-queue-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Set create_document to auto-confirm so agent can create docs without user interaction
    const assignee = await getAssignee(id);
    const permissions = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission:
        tp.toolName === "create_document" ? "auto-confirm" : "manual-confirm",
    }));
    await updateAssigneePermissions(id, permissions);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe("Queue task execution", () => {
  test.setTimeout(180_000);

  test("cron-scheduled task creates a document via the agent", async ({
    assigneeId,
  }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    // 1. Create a cron task that fires every minute — Celery will pick it up
    const createRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assigneeId,
        title: "Queue E2E test",
        description: "Say hi in the chat and don't do anything else.",
        cronSchedule: "* * * * *", // cron syntax for every minute
        isCronEnabled: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as { id: string };
    console.log(
      `Created cron task ${task.id}, waiting for Celery to trigger...`,
    );

    // 2. Poll for a chat session to appear on this task
    let sessionId: string | undefined;
    for (let i = 0; i < 80; i++) {
      const sessionsRes = await fetch(
        `${BASE_URL}/api/tasks/${task.id}/chat-sessions`,
        {
          headers,
        },
      );
      if (sessionsRes.ok) {
        const sessions = (await sessionsRes.json()) as Array<{
          id: string;
          status: string;
        }>;
        if (sessions.length > 0) {
          sessionId = sessions[0]!.id;
          console.log(
            `Chat session created: ${sessionId} (after ${i + 1} polls)`,
          );
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(sessionId).toBeTruthy();
  });
});
