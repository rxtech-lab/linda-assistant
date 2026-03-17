import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  sendMessage,
  consumeStream,
  getChatHistory,
  updateAssigneePermissions,
  findToolCallParts,
  findToolResultParts,
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
    const id = await createAssignee(`e2e-task-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Set create_task and update_task to auto-confirm so agent can create/update tasks without user interaction
    const assignee = await getAssignee(id);
    const permissions = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission:
        tp.toolName === "create_task" || tp.toolName === "update_task"
          ? "auto-confirm"
          : "manual-confirm",
    }));
    await updateAssigneePermissions(id, permissions);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe.serial("Agent task creation", () => {
  test.setTimeout(300_000);

  test("agent creates a task when asked via chat", async ({ assigneeId }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    // Start consuming stream before sending message
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "agent-create-task",
    });

    // Send message asking the agent to create a task
    await sendMessage(
      assigneeId,
      'Create a task titled "Daily S&P 500 Report" with description "Send daily S&P 500 market summary email". ' +
        'Use tags ["finance", "daily"] and categories ["reports"]. ' +
        "Do not ask any questions, just create the task immediately.",
    );
    await stream.waitForDone();

    // Verify agent used create_task tool
    const toolCallEvents = stream.events.filter(
      (e) => e.event === "tool-call" && e.data.toolName === "create_task",
    );
    expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);

    // Verify tool-result was received
    const toolResultEvents = stream.events.filter(
      (e) => e.event === "tool-result" && e.data.toolName === "create_task",
    );
    expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);

    // Extract taskId from the tool result and verify no error
    const toolResult = toolResultEvents[0]!.data;
    const output = toolResult.output as Record<string, unknown>;
    expect(output.error).toBeUndefined();
    expect(output.taskId).toBeTruthy();
    const taskId = output.taskId as string;

    // Verify the task was created via API
    const taskRes = await fetch(`${BASE_URL}/api/tasks/${taskId}`, { headers });
    expect(taskRes.ok).toBe(true);
    const task = (await taskRes.json()) as {
      id: string;
      title: string;
      description: string;
      tags: string[];
      categories: string[];
      status: string;
    };
    expect(task.title).toBe("Daily S&P 500 Report");
    expect(task.description).toBe("Send daily S&P 500 market summary email");
    expect(task.tags).toEqual(["finance", "daily"]);
    expect(task.categories).toEqual(["reports"]);
    expect(task.status).toBe("pending");

    // Verify tool call and result appear in chat history
    const history = await getChatHistory(assigneeId);
    const createTaskCalls = findToolCallParts(history.messages, "create_task");
    expect(createTaskCalls.length).toBeGreaterThanOrEqual(1);
    const createTaskResults = findToolResultParts(
      history.messages,
      "create_task",
    );
    expect(createTaskResults.length).toBeGreaterThanOrEqual(1);

    // Clean up the task
    await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
      method: "DELETE",
      headers,
    });

    stream.cancel();
  });

  test("agent creates a cron-scheduled task", async ({ assigneeId }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "agent-create-cron-task",
    });

    await sendMessage(
      assigneeId,
      'Create a task titled "Daily Report" with cron schedule "0 9 * * 1-5". Do not ask questions, just create it immediately.',
    );
    await stream.waitForDone();

    // Verify agent used create_task tool
    const toolCallEvents = stream.events.filter(
      (e) => e.event === "tool-call" && e.data.toolName === "create_task",
    );
    expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);

    // Verify tool-result was received
    const toolResultEvents = stream.events.filter(
      (e) => e.event === "tool-result" && e.data.toolName === "create_task",
    );
    expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);

    // Extract taskId from the tool result and verify no error
    const toolResult = toolResultEvents[0]!.data;
    const output = toolResult.output as Record<string, unknown>;
    expect(output.error).toBeUndefined();
    expect(output.taskId).toBeTruthy();
    const taskId = output.taskId as string;

    // Verify the task was created via API with cron schedule
    const taskRes = await fetch(`${BASE_URL}/api/tasks/${taskId}`, { headers });
    expect(taskRes.ok).toBe(true);
    const task = (await taskRes.json()) as {
      id: string;
      title: string;
      cronSchedule: string | null;
      status: string;
    };
    expect(task.title).toBe("Daily Report");
    expect(task.cronSchedule).toBeTruthy();
    expect(task.status).toBe("running");

    // Verify in chat history
    const history = await getChatHistory(assigneeId);
    const createTaskCalls = findToolCallParts(history.messages, "create_task");
    expect(createTaskCalls.length).toBeGreaterThanOrEqual(1);
    const createTaskResults = findToolResultParts(
      history.messages,
      "create_task",
    );
    expect(createTaskResults.length).toBeGreaterThanOrEqual(1);

    // Clean up the task
    await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
      method: "DELETE",
      headers,
    });

    stream.cancel();
  });

  test("agent creates a runsAt-scheduled task", async ({ assigneeId }) => {
    const token = loadToken();
    const headers = authHeaders(token);

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "agent-create-runsat-task",
    });

    await sendMessage(
      assigneeId,
      'Create a task titled "Send Weekly Summary" scheduled to run at "2026-12-01T10:00:00". Do not ask questions, just create it immediately.',
    );
    await stream.waitForDone();

    // Verify agent used create_task tool
    const toolCallEvents = stream.events.filter(
      (e) => e.event === "tool-call" && e.data.toolName === "create_task",
    );
    expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);

    // Verify tool-result was received
    const toolResultEvents = stream.events.filter(
      (e) => e.event === "tool-result" && e.data.toolName === "create_task",
    );
    expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);

    // Extract taskId from the tool result and verify no error
    const toolResult = toolResultEvents[0]!.data;
    const output = toolResult.output as Record<string, unknown>;
    expect(output.error).toBeUndefined();
    expect(output.taskId).toBeTruthy();
    const taskId = output.taskId as string;

    // Verify the task was created via API with runsAt schedule
    const taskRes = await fetch(`${BASE_URL}/api/tasks/${taskId}`, { headers });
    expect(taskRes.ok).toBe(true);
    const task = (await taskRes.json()) as {
      id: string;
      title: string;
      runsAt: string | null;
      cronSchedule: string | null;
      status: string;
    };
    expect(task.title).toBe("Send Weekly Summary");
    expect(task.runsAt).toBeTruthy();
    expect(task.cronSchedule).toBeNull();
    expect(task.status).toBe("running");

    // Verify in chat history
    const history = await getChatHistory(assigneeId);
    const createTaskCalls = findToolCallParts(history.messages, "create_task");
    expect(createTaskCalls.length).toBeGreaterThanOrEqual(1);
    const createTaskResults = findToolResultParts(
      history.messages,
      "create_task",
    );
    expect(createTaskResults.length).toBeGreaterThanOrEqual(1);

    // Clean up the task
    await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
      method: "DELETE",
      headers,
    });

    stream.cancel();
  });
});
