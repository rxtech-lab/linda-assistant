import { test as base, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  updateAssigneePermissions,
  createTask,
  deleteTask,
  executeTaskNow,
  consumeSessionStream,
  getSessionMessages,
  findToolCallParts,
} from "./chat.utils";

// Fixture: each test gets its own assignee, deleted after test
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-task-chat-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Set all tool permissions to auto-confirm so the agent can proceed without user interaction
    const assignee = await getAssignee(id);
    const allAutoConfirm = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission: "auto-confirm",
    }));
    await updateAssigneePermissions(id, allAutoConfirm);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe.serial("Task chat session", () => {
  test.setTimeout(300_000);

  test("basic task chat - execute and get response", async ({ assigneeId }) => {
    // Create a simple task
    const taskId = await createTask(
      assigneeId,
      "Say Hello",
      "Say hello to the user. Just respond with a friendly greeting.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Execute the task
      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      // Connect to the session stream
      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-chat-basic",
      });

      // Wait for the agent to finish
      await stream.waitForDone();

      // Verify agent produced text response
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Verify messages in history
      const { messages } = await getSessionMessages(sessionId);
      expect(messages.length).toBeGreaterThanOrEqual(2); // user message + assistant response

      // Should have at least one assistant message with text content
      const assistantMessages = messages.filter((m) => m.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

      stream.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });

  test("task chat excludes task tools", async ({ assigneeId }) => {
    // Create a task with description that would normally trigger task creation
    const taskId = await createTask(
      assigneeId,
      "Stock Research",
      "Every day at America/New_York time before the US stock market opens, gather pre-market news; organize into a document, then create a briefing.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Execute the task
      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      // Connect to the session stream
      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-chat-no-task-tools",
      });

      // Wait for the agent to finish
      await stream.waitForDone();

      // Verify NO create_task tool calls in stream events
      const createTaskCalls = stream.events.filter(
        (e) => e.event === "tool-call" && e.data.toolName === "create_task",
      );
      expect(createTaskCalls).toHaveLength(0);

      // Verify NO update_task tool calls in stream events
      const updateTaskCalls = stream.events.filter(
        (e) => e.event === "tool-call" && e.data.toolName === "update_task",
      );
      expect(updateTaskCalls).toHaveLength(0);

      // Also verify via message history
      const { messages } = await getSessionMessages(sessionId);
      const createTaskParts = findToolCallParts(messages, "create_task");
      expect(createTaskParts).toHaveLength(0);
      const updateTaskParts = findToolCallParts(messages, "update_task");
      expect(updateTaskParts).toHaveLength(0);

      stream.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });
});
