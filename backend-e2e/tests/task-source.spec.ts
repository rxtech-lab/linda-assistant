import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  createAssigneeWithEmail,
  deleteAssignee,
  getAssignee,
  getTask,
  deleteTask,
  sendMessage,
  consumeStream,
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

// Fixture: each test gets its own assignee with create_task auto-confirmed
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-source-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Auto-confirm create_task so agent can create tasks without interaction
    const assignee = await getAssignee(id);
    const permissions = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission:
        tp.toolName === "create_task" ? "auto-confirm" : "manual-confirm",
    }));
    await updateAssigneePermissions(id, permissions);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

// ---- Helpers ----

async function createEmail(
  headers: Record<string, string>,
  assigneeId: string,
  subject: string,
): Promise<{ id: string; emailId: string }> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${BASE_URL}/api/inbox/emails`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      emailId: `e2e-email-${suffix}`,
      assigneeId,
      fromEmail: "sender@example.com",
      fromName: "E2E Sender",
      toEmail: "assistant@test.rxlab.app",
      subject,
      textBody: `Test email body for ${subject}`,
      receivedAt: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /api/inbox/emails failed (${res.status}): ${text}`);
  }
  const created = (await res.json()) as { id: string; emailId: string };
  return created;
}

async function listEmails(
  headers: Record<string, string>,
): Promise<{ data: Array<{ id: string; subject: string; [k: string]: unknown }> }> {
  const res = await fetch(`${BASE_URL}/api/inbox/emails?limit=100`, { headers });
  if (!res.ok) throw new Error(`GET /api/inbox/emails failed (${res.status})`);
  return res.json() as any;
}

async function deleteEmail(
  headers: Record<string, string>,
  emailId: string,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/emails/${emailId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE /api/inbox/emails/${emailId} failed (${res.status})`);
  }
}

async function listTasks(
  headers: Record<string, string>,
  source?: string,
): Promise<{ data: Array<{ id: string; source: string | null; title: string; [k: string]: unknown }> }> {
  const url = source
    ? `${BASE_URL}/api/tasks?limit=100&source=${source}`
    : `${BASE_URL}/api/tasks?limit=100`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET /api/tasks failed (${res.status})`);
  return res.json() as any;
}

// ---- Tests ----

test.describe("Task source labels", () => {
  test.setTimeout(300_000);

  test("API-created task has source=manual by default", async ({ assigneeId }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    // Create a task via API without specifying source
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assigneeId,
        title: "Manual E2E Task",
        description: "Created via API for source label test",
      }),
    });
    expect(res.ok).toBe(true);
    const created = (await res.json()) as { id: string; source: string };
    expect(created.source).toBe("manual");

    // Verify via GET
    const task = await getTask(created.id);
    expect(task.source).toBe("manual");

    // Cleanup
    await deleteTask(created.id);
  });

  test("agent-created task has source=agent", async ({ assigneeId }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "agent-source-test",
    });

    await sendMessage(
      assigneeId,
      'Create a task titled "Agent Source Test Task" with description "Testing agent source label". Do not ask any questions, just create it immediately.',
    );
    await stream.waitForDone();

    // Extract taskId from tool result
    const toolResultEvents = stream.events.filter(
      (e) => e.event === "tool-result" && e.data.toolName === "create_task",
    );
    expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);

    const output = toolResultEvents[0]!.data.output as Record<string, unknown>;
    expect(output.error).toBeUndefined();
    expect(output.taskId).toBeTruthy();
    const taskId = output.taskId as string;

    // Verify source is "agent"
    const task = await getTask(taskId);
    expect(task.source).toBe("agent");

    // Cleanup
    await deleteTask(taskId);
    stream.cancel();
  });

  test("email-linked task has source=email", async ({ assigneeId }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    // Create an email record first
    const email = await createEmail(headers, assigneeId, "Email Source Test");

    // Create a task linked to the email
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assigneeId,
        title: "Email Source Test Task",
        description: "Created from email for source label test",
        emailId: email.id,
      }),
    });
    expect(res.ok).toBe(true);
    const created = (await res.json()) as { id: string; source: string };

    // Source should default to "email" when emailId is provided
    expect(created.source).toBe("email");

    // Verify via GET
    const task = await getTask(created.id);
    expect(task.source).toBe("email");

    // Cleanup
    await deleteTask(created.id);
    await deleteEmail(headers, email.id);
  });

  test("filter tasks by source label", async ({ assigneeId }) => {
    const token = loadToken();
    const headers = authHeaders(token);
    const createdIds: string[] = [];

    try {
      // 1. Create a manual task
      const manualRes = await fetch(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          assigneeId,
          title: "Filter Test - Manual",
          description: "Manual task for filter test",
        }),
      });
      expect(manualRes.ok).toBe(true);
      const manualTask = (await manualRes.json()) as { id: string };
      createdIds.push(manualTask.id);

      // 2. Create an email-linked task
      const email = await createEmail(headers, assigneeId, "Filter Test Email");
      const emailRes = await fetch(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          assigneeId,
          title: "Filter Test - Email",
          description: "Email task for filter test",
          emailId: email.id,
        }),
      });
      expect(emailRes.ok).toBe(true);
      const emailTask = (await emailRes.json()) as { id: string };
      createdIds.push(emailTask.id);

      // 3. Create an agent task via chat
      const stream = consumeStream(assigneeId, {
        timeout: 180_000,
        label: "filter-agent-task",
      });

      await sendMessage(
        assigneeId,
        'Create a task titled "Filter Test - Agent" with description "Agent task for filter test". Do not ask any questions, just create it immediately.',
      );
      await stream.waitForDone();

      const toolResultEvents = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "create_task",
      );
      expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);
      const agentOutput = toolResultEvents[0]!.data.output as Record<string, unknown>;
      expect(agentOutput.taskId).toBeTruthy();
      createdIds.push(agentOutput.taskId as string);
      stream.cancel();

      // 4. Filter by source=manual
      const manualList = await listTasks(headers, "manual");
      const manualFiltered = manualList.data.filter((t) =>
        createdIds.includes(t.id),
      );
      expect(manualFiltered.length).toBe(1);
      expect(manualFiltered[0]!.title).toBe("Filter Test - Manual");
      expect(manualFiltered[0]!.source).toBe("manual");

      // 5. Filter by source=email
      const emailList = await listTasks(headers, "email");
      const emailFiltered = emailList.data.filter((t) =>
        createdIds.includes(t.id),
      );
      expect(emailFiltered.length).toBe(1);
      expect(emailFiltered[0]!.title).toBe("Filter Test - Email");
      expect(emailFiltered[0]!.source).toBe("email");

      // 6. Filter by source=agent
      const agentList = await listTasks(headers, "agent");
      const agentFiltered = agentList.data.filter((t) =>
        createdIds.includes(t.id),
      );
      expect(agentFiltered.length).toBe(1);
      expect(agentFiltered[0]!.title).toBe("Filter Test - Agent");
      expect(agentFiltered[0]!.source).toBe("agent");

      // Cleanup email
      await deleteEmail(headers, email.id);
    } finally {
      // Cleanup all tasks
      for (const id of createdIds) {
        await deleteTask(id);
      }
    }
  });
});

test.describe("Email webhook creates email and task", () => {
  test.setTimeout(300_000);

  test("inbound emails route to correct assistants via webhook", async () => {
    const token = loadToken();
    const headers = authHeaders(token);

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      test.skip(true, "RESEND_API_KEY not set — skipping webhook e2e test");
      return;
    }

    const domain = process.env.RESEND_DOMAIN || "assistant.rxlab.app";
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const emailA = `e2e-a-${suffix}@${domain}`;
    const emailB = `e2e-b-${suffix}@${domain}`;

    // Create two assistants with different emails on the Resend domain
    const assigneeAId = await createAssigneeWithEmail(`e2e-webhook-a-${suffix}`, emailA);
    const assigneeBId = await createAssigneeWithEmail(`e2e-webhook-b-${suffix}`, emailB);
    console.log(`Created assignee A (${assigneeAId}) with email: ${emailA}`);
    console.log(`Created assignee B (${assigneeBId}) with email: ${emailB}`);

    const subjectA = `E2E Webhook A ${suffix}`;
    const subjectB = `E2E Webhook B ${suffix}`;

    // Send emails to both assistants via Resend API
    for (const [email, subject] of [
      [emailA, subjectA],
      [emailB, subjectB],
    ] as const) {
      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `e2e-test@${domain}`,
          to: [email],
          subject,
          text: `E2E webhook routing test for ${email}`,
        }),
      });

      if (!sendRes.ok) {
        const err = await sendRes.text();
        console.log(`Resend send to ${email} failed (${sendRes.status}): ${err}`);
        test.skip(true, `Resend send failed: ${sendRes.status}`);
        return;
      }
      const sendData = (await sendRes.json()) as { id: string };
      console.log(`Sent email to ${email}: ${sendData.id}, subject: ${subject}`);
    }

    // Poll for both emails to appear
    let foundEmailA: { id: string; subject: string; assigneeId?: string; [k: string]: unknown } | undefined;
    let foundEmailB: { id: string; subject: string; assigneeId?: string; [k: string]: unknown } | undefined;
    for (let i = 0; i < 60; i++) {
      const emails = await listEmails(headers);
      if (!foundEmailA) foundEmailA = emails.data.find((e) => e.subject === subjectA);
      if (!foundEmailB) foundEmailB = emails.data.find((e) => e.subject === subjectB);
      if (foundEmailA && foundEmailB) break;
      await new Promise((r) => setTimeout(r, 3000));
    }

    expect(foundEmailA).toBeTruthy();
    expect(foundEmailB).toBeTruthy();
    console.log(`Email A found: ${foundEmailA!.id}, assigneeId: ${foundEmailA!.assigneeId}`);
    console.log(`Email B found: ${foundEmailB!.id}, assigneeId: ${foundEmailB!.assigneeId}`);

    // Verify each email routed to the correct assignee
    expect(foundEmailA!.assigneeId).toBe(assigneeAId);
    expect(foundEmailB!.assigneeId).toBe(assigneeBId);

    // Poll for auto-created tasks with source=email
    let foundTaskA: { id: string; source: string | null; title: string } | undefined;
    let foundTaskB: { id: string; source: string | null; title: string } | undefined;
    for (let i = 0; i < 30; i++) {
      const tasksList = await listTasks(headers, "email");
      if (!foundTaskA) foundTaskA = tasksList.data.find((t) => t.title.includes(subjectA));
      if (!foundTaskB) foundTaskB = tasksList.data.find((t) => t.title.includes(subjectB));
      if (foundTaskA && foundTaskB) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    expect(foundTaskA).toBeTruthy();
    expect(foundTaskA!.source).toBe("email");
    expect(foundTaskB).toBeTruthy();
    expect(foundTaskB!.source).toBe("email");
    console.log(`Task A: ${foundTaskA!.id}, Task B: ${foundTaskB!.id}`);

    // Cleanup
    if (foundTaskA) await deleteTask(foundTaskA.id);
    if (foundTaskB) await deleteTask(foundTaskB.id);
    if (foundEmailA) await deleteEmail(headers, foundEmailA.id);
    if (foundEmailB) await deleteEmail(headers, foundEmailB.id);
    await deleteAssignee(assigneeAId);
    await deleteAssignee(assigneeBId);
  });
});
