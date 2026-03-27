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
  updateTaskPermissions,
  getTask,
  getTaskTools,
  listConfirmations,
  resolveConfirmation,
} from "./chat.utils";

// Fixture: each test gets its own assignee, deleted after test
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-task-auto-confirm-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Set assignee permissions: get_current_time to manual-confirm
    const assignee = await getAssignee(id);
    const permissions = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission:
        tp.toolName === "get_current_time" ? "manual-confirm" : "auto-confirm",
    }));
    await updateAssigneePermissions(id, permissions);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe("Task auto-confirm via alwaysAllow", () => {
  test.setTimeout(300_000);

  test("alwaysAllow in task chat updates task permissions, not assignee, and re-execution auto-confirms", async ({
    assigneeId,
  }) => {
    // Create a task that will call get_current_time
    const taskId = await createTask(
      assigneeId,
      "Auto Confirm Test",
      "Get the current time and tell me what time it is. Do not ask any questions, just get the time immediately.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Verify task inherited manual-confirm for get_current_time
      const taskBefore = await getTask(taskId);
      const timePerm = taskBefore.toolPermissions?.find(
        (tp: { toolName: string }) => tp.toolName === "get_current_time",
      );
      expect(timePerm).toBeDefined();
      expect(timePerm!.permission).toBe("manual-confirm");

      // --- First execution: should require confirmation ---
      const { sessionId: sessionId1 } = await executeTaskNow(taskId);
      console.log(`Task executed (1st), session: ${sessionId1}`);

      const stream1 = consumeSessionStream(sessionId1, {
        timeout: 180_000,
        label: "task-auto-confirm-1st",
      });

      // Wait for confirmation_required event
      const confirmEvent = await stream1.waitForEvent("confirmation_required");
      expect(confirmEvent).toBeTruthy();
      expect(confirmEvent.data.toolName).toBe("get_current_time");
      console.log("Got confirmation_required for get_current_time");

      // Find the pending confirmation scoped to this session
      const pendingConfirmations = await listConfirmations();
      const timeConfirmation = pendingConfirmations.find(
        (c) =>
          c.toolName === "get_current_time" &&
          c.status === "pending" &&
          c.chatSessionId === sessionId1,
      );
      expect(timeConfirmation).toBeTruthy();

      // Resolve with alwaysAllow: true
      await resolveConfirmation(timeConfirmation!.id, "confirm", {
        alwaysAllow: true,
      });
      console.log("Resolved confirmation with alwaysAllow: true");

      // Wait for agent to finish
      await stream1.waitForDone();
      stream1.cancel();

      // --- Verify: task permissions updated to auto-confirm ---
      const taskAfter = await getTask(taskId);
      const timePermAfter = taskAfter.toolPermissions?.find(
        (tp: { toolName: string }) => tp.toolName === "get_current_time",
      );
      expect(timePermAfter).toBeDefined();
      expect(timePermAfter!.permission).toBe("auto-confirm");
      console.log("Task permission updated to auto-confirm");

      // --- Verify: assignee permissions unchanged (still manual-confirm) ---
      const assigneeAfter = await getAssignee(assigneeId);
      const assigneeTimePerm = assigneeAfter.toolPermissions.find(
        (tp) => tp.toolName === "get_current_time",
      );
      expect(assigneeTimePerm).toBeDefined();
      expect(assigneeTimePerm!.permission).toBe("manual-confirm");
      console.log("Assignee permission still manual-confirm");

      // --- Second execution: should auto-confirm without confirmation ---
      const { sessionId: sessionId2 } = await executeTaskNow(taskId);
      console.log(`Task executed (2nd), session: ${sessionId2}`);

      const stream2 = consumeSessionStream(sessionId2, {
        timeout: 180_000,
        label: "task-auto-confirm-2nd",
      });

      // Wait for agent to finish
      await stream2.waitForDone();

      // Verify: tool-call and tool-result for get_current_time appeared
      const toolCallEvents = stream2.events.filter(
        (e) =>
          e.event === "tool-call" && e.data.toolName === "get_current_time",
      );
      expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);

      const toolResultEvents = stream2.events.filter(
        (e) =>
          e.event === "tool-result" && e.data.toolName === "get_current_time",
      );
      expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);

      // Verify: NO confirmation_required event in second execution
      const confirmEvents = stream2.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmEvents).toHaveLength(0);
      console.log("Second execution completed without confirmation");

      // --- Verify: task tools API reflects the auto-confirm permission ---
      const taskTools = await getTaskTools(taskId);
      const timeToolFromApi = taskTools.find(
        (t) => t.name === "get_current_time",
      );
      expect(timeToolFromApi).toBeDefined();
      expect(timeToolFromApi!.defaultPermission).toBe("auto-confirm");
      console.log(
        "Task tools API confirms get_current_time is auto-confirm",
      );

      stream2.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });
});
