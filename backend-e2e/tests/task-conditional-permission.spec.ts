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
  listConfirmations,
  resolveConfirmation,
} from "./chat.utils";

// Fixture: each test gets its own assignee, deleted after test
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(
      `e2e-task-cond-perm-${testInfo.testId}`,
    );
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Set assignee permissions: send_email to manual-confirm (default)
    // The task will override this with conditional auto-confirm
    const assignee = await getAssignee(id);
    const permissions = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission:
        tp.toolName === "send_email" ? "manual-confirm" : "auto-confirm",
    }));
    await updateAssigneePermissions(id, permissions);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe.serial("Task conditional tool permissions", () => {
  test.setTimeout(300_000);

  test("task conditional permission auto-executes when condition met (contains)", async ({
    assigneeId,
  }) => {
    // Create a task
    const taskId = await createTask(
      assigneeId,
      "Conditional Permission Test - Match",
      'Send an email to "hello@xxx-corp.com" with subject "Test" and body "Hello World". Do not ask any questions, just send the email immediately.',
    );
    console.log(`Created task ${taskId}`);

    try {
      // Update task permissions: send_email has conditional auto-confirm
      // Condition: "to" parameter contains "xxx"
      await updateTaskPermissions(taskId, [
        {
          toolName: "send_email",
          permission: "auto-confirm",
          conditions: [
            {
              parameterName: "to",
              parameterType: "string",
              operator: "contains",
              value: "xxx",
            },
          ],
        },
        { toolName: "search_emails", permission: "auto-confirm" },
        { toolName: "create_task", permission: "auto-confirm" },
        { toolName: "update_task", permission: "auto-confirm" },
        { toolName: "get_current_time", permission: "auto-confirm" },
      ]);

      // Execute the task
      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      // Connect to the session stream
      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-cond-perm-match",
      });

      // Wait for agent to finish
      await stream.waitForDone();

      // Verify: tool-call for send_email should appear (agent called the tool)
      const toolCallEvents = stream.events.filter(
        (e) => e.event === "tool-call" && e.data.toolName === "send_email",
      );
      expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);

      // Verify: tool-result for send_email should appear (tool was auto-executed)
      const toolResultEvents = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "send_email",
      );
      expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);

      // Verify: NO confirmation_required event (conditions were met, auto-executed)
      const confirmEvents = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmEvents).toHaveLength(0);

      stream.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });

  test("task conditional permission requires confirmation when condition NOT met", async ({
    assigneeId,
  }) => {
    // Create a task where the email address does NOT contain "xxx"
    const taskId = await createTask(
      assigneeId,
      "Conditional Permission Test - No Match",
      'Send an email to "hello@normal-corp.com" with subject "Test" and body "Hello World". Do not ask any questions, just send the email immediately.',
    );
    console.log(`Created task ${taskId}`);

    try {
      // Update task permissions: send_email has conditional auto-confirm
      // Condition: "to" parameter contains "xxx"
      // Since the email is to hello@normal-corp.com, the condition will NOT match
      await updateTaskPermissions(taskId, [
        {
          toolName: "send_email",
          permission: "auto-confirm",
          conditions: [
            {
              parameterName: "to",
              parameterType: "string",
              operator: "contains",
              value: "xxx",
            },
          ],
        },
        { toolName: "search_emails", permission: "auto-confirm" },
        { toolName: "create_task", permission: "auto-confirm" },
        { toolName: "update_task", permission: "auto-confirm" },
        { toolName: "get_current_time", permission: "auto-confirm" },
      ]);

      // Execute the task
      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      // Connect to the session stream
      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-cond-perm-no-match",
      });

      // Wait for confirmation_required event (conditions were NOT met)
      const confirmEvent = await stream.waitForEvent("confirmation_required");
      expect(confirmEvent).toBeTruthy();
      expect(confirmEvent.data.toolName).toBe("send_email");

      // Verify: a confirmation record was created
      const confirmations = await listConfirmations();
      const sendEmailConfirmation = confirmations.find(
        (c) => c.toolName === "send_email" && c.status === "pending",
      );
      expect(sendEmailConfirmation).toBeTruthy();

      // Reject the confirmation to allow cleanup
      if (sendEmailConfirmation) {
        await resolveConfirmation(sendEmailConfirmation.id, "reject");
      }

      stream.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });

  test("task permission overrides assignee permission", async ({
    assigneeId,
  }) => {
    // Assignee has send_email set to manual-confirm (set in fixture)
    // Task will override to auto-confirm (no conditions)
    const taskId = await createTask(
      assigneeId,
      "Permission Override Test",
      'Send an email to "test@example.com" with subject "Override Test" and body "Testing permission override". Do not ask any questions, just send the email immediately.',
    );
    console.log(`Created task ${taskId}`);

    try {
      // Update task permissions: send_email to auto-confirm (overriding assignee's manual-confirm)
      await updateTaskPermissions(taskId, [
        { toolName: "send_email", permission: "auto-confirm" },
        { toolName: "search_emails", permission: "auto-confirm" },
        { toolName: "create_task", permission: "auto-confirm" },
        { toolName: "update_task", permission: "auto-confirm" },
        { toolName: "get_current_time", permission: "auto-confirm" },
      ]);

      // Execute the task
      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      // Connect to the session stream
      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-perm-override",
      });

      // Wait for agent to finish - should complete without confirmation
      await stream.waitForDone();

      // Verify: tool-result for send_email should appear (auto-executed using task permission)
      const toolResultEvents = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "send_email",
      );
      expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);

      // Verify: NO confirmation_required event (task permission is auto-confirm)
      const confirmEvents = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmEvents).toHaveLength(0);

      stream.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });
});
