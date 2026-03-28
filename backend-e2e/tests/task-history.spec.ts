import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
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
  sendSessionMessage,
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

async function listHistory(
  assigneeId?: string,
  search?: string,
): Promise<{
  data: Array<{
    id: string;
    taskId: string;
    chatSessionId: string;
    assigneeId: string | null;
    summary: string;
    toolCalls: string[] | null;
    status: string | null;
    durationSecs: number | null;
    taskTitle: string;
    score?: number;
    createdAt: string | null;
  }>;
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}> {
  const token = loadToken();
  const params = new URLSearchParams();
  if (assigneeId) params.set("assigneeId", assigneeId);
  if (search) params.set("search", search);
  const res = await fetch(`${BASE_URL}/api/history?${params.toString()}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`GET /api/history failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as any;
}

// Fixture: each test gets its own assignee with all tools auto-confirmed
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-history-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Set all tools to auto-confirm so tasks run without interruption
    const assignee = await getAssignee(id);
    const permissions = assignee.toolPermissions.map(
      (tp: { toolName: string }) => ({
        toolName: tp.toolName,
        permission: "auto-confirm",
      }),
    );
    await updateAssigneePermissions(id, permissions);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe("Task History", () => {
  test.setTimeout(300_000);

  test("history is created after task session completes", async ({
    assigneeId,
  }) => {
    // Create and execute a task
    const taskId = await createTask(
      assigneeId,
      "History Test Task",
      "Say hello and confirm the task is done.",
    );
    console.log(`Created task ${taskId}`);

    try {
      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      // Consume the stream until done
      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "history-test",
      });
      await stream.waitForDone();
      console.log("Task session completed");

      // Wait for history generation (fire-and-forget, give it a moment)
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // Verify history was created
      const historyResult = await listHistory(assigneeId);
      expect(historyResult.data.length).toBeGreaterThanOrEqual(1);

      const entry = historyResult.data.find((h) => h.taskId === taskId);
      expect(entry).toBeDefined();
      expect(entry!.chatSessionId).toBe(sessionId);
      expect(entry!.assigneeId).toBe(assigneeId);
      expect(entry!.summary).toBeTruthy();
      expect(entry!.taskTitle).toBe("History Test Task");
      expect(entry!.createdAt).toBeTruthy();
      console.log(`History entry created: ${entry!.id}, summary: ${entry!.summary.slice(0, 80)}...`);
    } finally {
      await deleteTask(taskId);
    }
  });

  test("continued chat in same session updates history instead of duplicating", async ({
    assigneeId,
  }) => {
    const taskId = await createTask(
      assigneeId,
      "History Upsert Task",
      "Say hello and confirm the task is done.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // First execution — history entry is created
      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      const stream1 = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "history-upsert-1",
      });
      await stream1.waitForDone();
      console.log("First session completed");

      await new Promise((resolve) => setTimeout(resolve, 3_000));

      const historyAfterFirst = await listHistory(assigneeId);
      const entriesForTask1 = historyAfterFirst.data.filter(
        (h) => h.taskId === taskId,
      );
      expect(entriesForTask1).toHaveLength(1);
      const firstEntryId = entriesForTask1[0].id;
      const firstSummary = entriesForTask1[0].summary;
      console.log(`First history entry: ${firstEntryId}, summary: ${firstSummary.slice(0, 80)}...`);

      // Second execution — send follow-up message in the same session
      await sendSessionMessage(sessionId, "Now say goodbye.");
      const stream2 = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "history-upsert-2",
      });
      await stream2.waitForDone();
      console.log("Second session completed");

      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // Verify: still only ONE history entry for this task, same id, but updated summary
      const historyAfterSecond = await listHistory(assigneeId);
      const entriesForTask2 = historyAfterSecond.data.filter(
        (h) => h.taskId === taskId,
      );
      expect(entriesForTask2).toHaveLength(1);
      expect(entriesForTask2[0].id).toBe(firstEntryId);
      expect(entriesForTask2[0].summary).toBeTruthy();
      console.log(
        `Updated history entry: ${entriesForTask2[0].id}, summary: ${entriesForTask2[0].summary.slice(0, 80)}...`,
      );
    } finally {
      await deleteTask(taskId);
    }
  });

  test("history API supports search", async ({ assigneeId }) => {
    // Create and execute a task so we have history to search
    const taskId = await createTask(
      assigneeId,
      "Searchable History Task",
      "Send a greeting message.",
    );
    console.log(`Created task ${taskId}`);

    try {
      const { sessionId } = await executeTaskNow(taskId);
      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "history-search-test",
      });
      await stream.waitForDone();

      // Wait for history generation
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // Search with a query
      const searchResult = await listHistory(assigneeId, "greeting");
      // In E2E mode, the mock embedding always returns the same vector,
      // so all results should have score ~1.0 and pass the threshold
      expect(searchResult.data).toBeDefined();
      expect(Array.isArray(searchResult.data)).toBe(true);

      console.log(`Search returned ${searchResult.data.length} results`);
    } finally {
      await deleteTask(taskId);
    }
  });
});
