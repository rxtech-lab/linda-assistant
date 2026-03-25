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
  executeTaskNowRaw,
  stopTask,
  getTask,
  consumeSessionStream,
} from "./chat.utils";

// Fixture: each test gets its own assignee, deleted after test
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-task-stop-${testInfo.testId}`);
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

test.describe.serial("Task stop prevents execution", () => {
  test.setTimeout(300_000);

  test("stopped task cannot be executed via execute-now", async ({
    assigneeId,
  }) => {
    // Create a simple task
    const taskId = await createTask(
      assigneeId,
      "Stopped Task Test",
      "Say hello to the user.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Stop the task
      await stopTask(taskId);
      console.log(`Stopped task ${taskId}`);

      // Verify task status is stopped
      const task = await getTask(taskId);
      expect(task.status).toBe("stopped");

      // Try to execute — should fail with 422
      const res = await executeTaskNowRaw(taskId);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect((body as { error: string }).error).toContain("stopped");
    } finally {
      await deleteTask(taskId);
    }
  });

  test("running task can be executed via execute-now", async ({
    assigneeId,
  }) => {
    // Create a task (default status is "pending")
    const taskId = await createTask(
      assigneeId,
      "Running Task Test",
      "Say hello to the user. Just respond with a friendly greeting.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Verify task can be executed (pending status should be fine)
      const { sessionId } = await executeTaskNow(taskId);
      expect(sessionId).toBeTruthy();
      console.log(`Task executed, session: ${sessionId}`);

      // Connect to the session stream and wait for completion
      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-stop-running",
      });
      await stream.waitForDone();

      // Verify agent produced text response
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      stream.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });
});
