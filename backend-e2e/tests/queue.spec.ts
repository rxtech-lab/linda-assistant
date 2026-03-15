import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  updateAssigneePermissions,
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
  test.setTimeout(120_000);

  test("scheduled task creates a document via the agent", async ({
    assigneeId,
  }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    // 1. Create a task with runsAt set 3 seconds from now
    const runsAt = new Date(Date.now() + 3000).toISOString();
    const createRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assigneeId,
        title: "Queue E2E test",
        description:
          "Create a document with title 'queue-test-doc' containing only the word 'hello'. Use markdown format. Do not ask any questions, do not use any other tools, just create the document immediately.",
        runsAt,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as { id: string };
    console.log(`Created task ${task.id} with runsAt=${runsAt}`);

    // 2. Poll for a chat session to appear on this task (Celery executes it at runsAt)
    let sessionId: string | undefined;
    for (let i = 0; i < 30; i++) {
      const sessionsRes = await fetch(
        `${BASE_URL}/api/tasks/${task.id}/chat-sessions`,
        { headers },
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

    // 3. Verify the chat session has at least one message (the user message from task description)
    const messagesRes = await fetch(
      `${BASE_URL}/api/chat/${assigneeId}/messages`,
      { headers },
    );
    expect(messagesRes.ok).toBe(true);
    const messagesBody = (await messagesRes.json()) as {
      messages: Array<{ role: string }>;
    };
    expect(messagesBody.messages.length).toBeGreaterThan(0);
  });

  test("2. delayed task (10s) triggers execution via the scheduler", async ({
    assigneeId,
  }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    // 1. Create a task with runsAt set 10 seconds from now
    const runsAt = new Date(Date.now() + 10000).toISOString();
    const createRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assigneeId,
        title: "Queue E2E delayed test",
        description: "Say hello.",
        runsAt,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as { id: string };
    console.log(`Created task ${task.id} with runsAt=${runsAt}`);

    // 2. Poll for a chat session to appear (Celery executes it at runsAt)
    let sessionId: string | undefined;
    for (let i = 0; i < 30; i++) {
      const sessionsRes = await fetch(
        `${BASE_URL}/api/tasks/${task.id}/chat-sessions`,
        { headers },
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

    // 3. Verify the chat session has at least one message
    const messagesRes = await fetch(
      `${BASE_URL}/api/chat/${assigneeId}/messages`,
      { headers },
    );
    expect(messagesRes.ok).toBe(true);
    const messagesBody = (await messagesRes.json()) as {
      messages: Array<{ role: string }>;
    };
    expect(messagesBody.messages.length).toBeGreaterThan(0);
  });

  test("3. execute-now creates a chat session immediately", async ({
    assigneeId,
  }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    // 1. Create a task without runsAt or cron (pending)
    const createRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assigneeId,
        title: "Queue E2E immediate test",
        description: "Say hello.",
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as { id: string };
    console.log(`Created task ${task.id} (pending, no schedule)`);

    // 2. Execute the task immediately via the execute-now endpoint
    const execRes = await fetch(
      `${BASE_URL}/api/tasks/${task.id}/execute-now`,
      { method: "POST", headers },
    );
    expect(execRes.status).toBe(200);
    const execBody = (await execRes.json()) as {
      sessionId: string;
      queued: boolean;
    };
    expect(execBody.queued).toBe(true);
    console.log(`Execute-now created session: ${execBody.sessionId}`);

    // 3. Verify the chat session has at least one message
    const messagesRes = await fetch(
      `${BASE_URL}/api/chat/${assigneeId}/messages`,
      { headers },
    );
    expect(messagesRes.ok).toBe(true);
    const messagesBody = (await messagesRes.json()) as {
      messages: Array<{ role: string }>;
    };
    expect(messagesBody.messages.length).toBeGreaterThan(0);
  });
});
