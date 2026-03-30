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
  sendMessage,
  sendSessionMessage,
  consumeStream,
  clearChatHistory,
} from "./chat.utils";
import fs from "node:fs";
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

// ---- Extension helpers ----

interface ExtensionWithStatus {
  id: string;
  type: string;
  title: string;
  prefix: string;
  enabled: boolean;
  toolPermissions: Array<{ toolName: string; permission: string }> | null;
  [key: string]: unknown;
}

async function listAssigneeExtensions(
  assigneeId: string,
): Promise<ExtensionWithStatus[]> {
  const token = loadToken();
  const res = await fetch(
    `${BASE_URL}/api/assignees/${assigneeId}/extensions`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) {
    throw new Error(
      `GET /api/assignees/${assigneeId}/extensions failed (${res.status}): ${await res.text()}`,
    );
  }
  return (await res.json()) as ExtensionWithStatus[];
}

async function updateAssigneeExtension(
  assigneeId: string,
  extensionId: string,
  settings: {
    enabled: boolean;
    toolPermissions?: Array<{ toolName: string; permission: string }>;
  },
): Promise<ExtensionWithStatus> {
  const token = loadToken();
  const res = await fetch(
    `${BASE_URL}/api/assignees/${assigneeId}/extensions/${extensionId}`,
    {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(settings),
    },
  );
  if (!res.ok) {
    throw new Error(
      `PUT /api/assignees/${assigneeId}/extensions/${extensionId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return (await res.json()) as ExtensionWithStatus;
}

async function listTaskExtensions(
  taskId: string,
): Promise<ExtensionWithStatus[]> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/extensions`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/tasks/${taskId}/extensions failed (${res.status}): ${await res.text()}`,
    );
  }
  return (await res.json()) as ExtensionWithStatus[];
}

async function updateTaskExtension(
  taskId: string,
  extensionId: string,
  settings: {
    enabled: boolean;
    toolPermissions?: Array<{ toolName: string; permission: string }>;
  },
): Promise<ExtensionWithStatus> {
  const token = loadToken();
  const res = await fetch(
    `${BASE_URL}/api/tasks/${taskId}/extensions/${extensionId}`,
    {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(settings),
    },
  );
  if (!res.ok) {
    throw new Error(
      `PUT /api/tasks/${taskId}/extensions/${extensionId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return (await res.json()) as ExtensionWithStatus;
}

async function getExtension(
  extensionId: string,
): Promise<
  ExtensionWithStatus & { tools?: Array<{ name: string; description: string }> }
> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/extensions/${extensionId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/extensions/${extensionId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return (await res.json()) as ExtensionWithStatus & {
    tools?: Array<{ name: string; description: string }>;
  };
}

const INVOICE_PREFIX = "invoice_";

// Fixture: each test gets its own assignee with all tools auto-confirmed
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-ext-search-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    const assignee = await getAssignee(id);
    const permissions = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission: "auto-confirm",
    }));
    await updateAssigneePermissions(id, permissions);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe
  .serial("Assignee-level extension toggle with search_tools", () => {
  test.setTimeout(300_000);

  test("disable invoice extension → search_tools finds nothing → enable → search_tools finds invoice tools", async ({
    assigneeId,
  }) => {
    // Find the invoice extension
    const extensions = await listAssigneeExtensions(assigneeId);
    const invoiceExt = extensions.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    // Get extension details for tool names
    const extDetails = await getExtension(invoiceExt!.id);
    const invoiceTools = extDetails.tools ?? [];
    expect(invoiceTools.length).toBeGreaterThan(0);
    console.log(
      `Invoice extension "${invoiceExt!.title}" has ${invoiceTools.length} tools:`,
      invoiceTools.map((t) => t.name),
    );

    // ---- Phase 1: Disable invoice extension → search_tools should find nothing ----

    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: false,
    });
    console.log("Disabled invoice extension on assignee");

    await clearChatHistory(assigneeId);

    const stream1 = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "ext-search-disabled",
    });

    try {
      await sendMessage(
        assigneeId,
        `Use search_tools to search for invoice related tools. Report exactly what tools you found. Do not ask any questions.`,
      );

      await stream1.waitForDone();

      // search_tools should have been called
      const searchCalls1 = stream1.events.filter(
        (e) => e.event === "tool-call" && e.data.toolName === "search_tools",
      );
      console.log(`[disabled] search_tools calls: ${searchCalls1.length}`);

      // Check search_tools results — should contain no invoice tools
      const searchResults1 = stream1.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "search_tools",
      );
      for (const result of searchResults1) {
        const output =
          typeof result.data.result === "string"
            ? result.data.result
            : JSON.stringify(result.data);
        console.log(`[disabled] search_tools result: ${output}`);
        // Should NOT contain any invoice-prefixed tool IDs
        for (const tool of invoiceTools) {
          expect(output).not.toContain(`${INVOICE_PREFIX}${tool.name}`);
        }
      }

      // Also check the text content — agent should indicate no tools found
      const textDeltas1 = stream1.events
        .filter((e) => e.event === "text-delta")
        .map((e) => e.data.delta ?? e.data.textDelta ?? "")
        .join("");
      console.log(
        `[disabled] Agent response (truncated): ${textDeltas1.slice(0, 300)}`,
      );
    } finally {
      stream1.cancel();
    }

    // ---- Phase 2: Enable invoice extension → search_tools should find invoice tools ----

    const invoiceToolPerms = invoiceTools.map((t) => ({
      toolName: t.name,
      permission: "auto-confirm",
    }));
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
      toolPermissions: invoiceToolPerms,
    });
    console.log("Enabled invoice extension on assignee with auto-confirm");

    await clearChatHistory(assigneeId);

    const stream2 = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "ext-search-enabled",
    });

    try {
      await sendMessage(
        assigneeId,
        `Use search_tools to search for invoice related tools. Report exactly what tools you found. Do not ask any questions.`,
      );

      await stream2.waitForDone();

      // search_tools should have been called
      const searchCalls2 = stream2.events.filter(
        (e) => e.event === "tool-call" && e.data.toolName === "search_tools",
      );
      expect(searchCalls2.length).toBeGreaterThanOrEqual(1);
      console.log(`[enabled] search_tools calls: ${searchCalls2.length}`);

      // Check search_tools results — should contain invoice tools
      const searchResults2 = stream2.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "search_tools",
      );
      expect(searchResults2.length).toBeGreaterThanOrEqual(1);

      let foundInvoiceTool = false;
      for (const result of searchResults2) {
        const output =
          typeof result.data.result === "string"
            ? result.data.result
            : JSON.stringify(result.data);
        console.log(`[enabled] search_tools result: ${output}`);
        for (const tool of invoiceTools) {
          if (
            output.includes(`${INVOICE_PREFIX}${tool.name}`) ||
            output.includes(tool.name)
          ) {
            foundInvoiceTool = true;
          }
        }
      }
      expect(foundInvoiceTool).toBe(true);
      console.log("[enabled] Invoice tools found in search_tools results");
    } finally {
      stream2.cancel();
    }
  });
});

test.describe.serial("Task-level extension toggle with search_tools", () => {
  test.setTimeout(300_000);

  test("disable invoice extension on task → search_tools finds nothing → enable → search_tools finds invoice tools", async ({
    assigneeId,
  }) => {
    // Enable invoice extension on assignee first so tasks inherit it
    const extensions = await listAssigneeExtensions(assigneeId);
    const invoiceExt = extensions.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    const extDetails = await getExtension(invoiceExt!.id);
    const invoiceTools = extDetails.tools ?? [];
    expect(invoiceTools.length).toBeGreaterThan(0);

    const invoiceToolPerms = invoiceTools.map((t) => ({
      toolName: t.name,
      permission: "auto-confirm",
    }));
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
      toolPermissions: invoiceToolPerms,
    });
    console.log("Enabled invoice extension on assignee (for task inheritance)");

    const TASK_DESCRIPTION =
      "Use search_tools to search for invoice related tools. Report exactly what tools you found. Do not ask any questions.";

    // ---- Phase 1: Task with invoice extension disabled ----

    const taskId1 = await createTask(
      assigneeId,
      "Extension Search Test - Disabled",
      TASK_DESCRIPTION,
    );
    console.log(`Created task ${taskId1} (will disable invoice ext)`);

    try {
      // Disable the invoice extension on this task
      await updateTaskExtension(taskId1, invoiceExt!.id, { enabled: false });

      // Verify task extension is disabled
      const taskExts1 = await listTaskExtensions(taskId1);
      const taskInvoice1 = taskExts1.find((e) => e.prefix === INVOICE_PREFIX);
      expect(taskInvoice1).toBeDefined();
      expect(taskInvoice1!.enabled).toBe(false);

      // Execute the task
      const { sessionId: sessionId1 } = await executeTaskNow(taskId1);
      console.log(`Task executed, session: ${sessionId1}`);

      const stream1 = consumeSessionStream(sessionId1, {
        timeout: 180_000,
        label: "task-ext-search-disabled",
      });

      await stream1.waitForDone();

      // Check search_tools results — should contain no invoice tools
      const searchResults1 = stream1.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "search_tools",
      );
      console.log(
        `[task-disabled] search_tools results: ${searchResults1.length}`,
      );

      for (const result of searchResults1) {
        const output =
          typeof result.data.result === "string"
            ? result.data.result
            : JSON.stringify(result.data);
        console.log(`[task-disabled] search_tools result: ${output}`);
        for (const tool of invoiceTools) {
          expect(output).not.toContain(`${INVOICE_PREFIX}${tool.name}`);
        }
      }

      // Log all tool calls for debugging
      const allToolCalls1 = stream1.events.filter(
        (e) => e.event === "tool-call",
      );
      console.log(
        `[task-disabled] All tool calls (${allToolCalls1.length}):`,
        allToolCalls1.map((e) => e.data.toolName),
      );

      stream1.cancel();
    } finally {
      await deleteTask(taskId1);
      console.log(`Deleted task ${taskId1}`);
    }

    // ---- Phase 2: Task with invoice extension enabled ----

    const taskId2 = await createTask(
      assigneeId,
      "Extension Search Test - Enabled",
      TASK_DESCRIPTION,
    );
    console.log(`Created task ${taskId2} (invoice ext inherited as enabled)`);

    try {
      // Verify task extension is enabled (inherited from assignee)
      const taskExts2 = await listTaskExtensions(taskId2);
      const taskInvoice2 = taskExts2.find((e) => e.prefix === INVOICE_PREFIX);
      expect(taskInvoice2).toBeDefined();
      expect(taskInvoice2!.enabled).toBe(true);

      // Execute the task
      const { sessionId: sessionId2 } = await executeTaskNow(taskId2);
      console.log(`Task executed, session: ${sessionId2}`);

      const stream2 = consumeSessionStream(sessionId2, {
        timeout: 180_000,
        label: "task-ext-search-enabled",
      });

      await stream2.waitForDone();

      // search_tools should have been called
      const searchCalls2 = stream2.events.filter(
        (e) => e.event === "tool-call" && e.data.toolName === "search_tools",
      );
      expect(searchCalls2.length).toBeGreaterThanOrEqual(1);
      console.log(`[task-enabled] search_tools calls: ${searchCalls2.length}`);

      // Check search_tools results — should contain invoice tools
      const searchResults2 = stream2.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "search_tools",
      );
      expect(searchResults2.length).toBeGreaterThanOrEqual(1);

      let foundInvoiceTool = false;
      for (const result of searchResults2) {
        const output =
          typeof result.data.result === "string"
            ? result.data.result
            : JSON.stringify(result.data);
        console.log(`[task-enabled] search_tools result: ${output}`);
        for (const tool of invoiceTools) {
          if (
            output.includes(`${INVOICE_PREFIX}${tool.name}`) ||
            output.includes(tool.name)
          ) {
            foundInvoiceTool = true;
          }
        }
      }
      expect(foundInvoiceTool).toBe(true);
      console.log("[task-enabled] Invoice tools found in search_tools results");

      // Log all tool calls for debugging
      const allToolCalls2 = stream2.events.filter(
        (e) => e.event === "tool-call",
      );
      console.log(
        `[task-enabled] All tool calls (${allToolCalls2.length}):`,
        allToolCalls2.map((e) => e.data.toolName),
      );

      stream2.cancel();
    } finally {
      await deleteTask(taskId2);
      console.log(`Deleted task ${taskId2}`);
    }
  });

  test("disable invoice extension on task → search_tools finds nothing → enable on same task → continue session → search_tools finds invoice tools", async ({
    assigneeId,
  }) => {
    // Enable invoice extension on assignee first so task inherits it
    const extensions = await listAssigneeExtensions(assigneeId);
    const invoiceExt = extensions.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    const extDetails = await getExtension(invoiceExt!.id);
    const invoiceTools = extDetails.tools ?? [];
    expect(invoiceTools.length).toBeGreaterThan(0);

    const invoiceToolPerms = invoiceTools.map((t) => ({
      toolName: t.name,
      permission: "auto-confirm",
    }));
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
      toolPermissions: invoiceToolPerms,
    });
    console.log("Enabled invoice extension on assignee (for task inheritance)");

    const TASK_DESCRIPTION =
      "Use search_tools to search for invoice related tools. Report exactly what tools you found. Do not ask any questions.";

    const taskId = await createTask(
      assigneeId,
      "Extension Search Test - Same Session Toggle",
      TASK_DESCRIPTION,
    );
    console.log(`Created task ${taskId}`);

    try {
      // ---- Phase 1: Disable invoice extension on task → execute → no invoice tools ----

      await updateTaskExtension(taskId, invoiceExt!.id, { enabled: false });

      const taskExts1 = await listTaskExtensions(taskId);
      const taskInvoice1 = taskExts1.find((e) => e.prefix === INVOICE_PREFIX);
      expect(taskInvoice1).toBeDefined();
      expect(taskInvoice1!.enabled).toBe(false);

      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      const stream1 = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-session-toggle-disabled",
      });

      await stream1.waitForDone();

      const searchResults1 = stream1.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "search_tools",
      );
      console.log(
        `[session-disabled] search_tools results: ${searchResults1.length}`,
      );

      for (const result of searchResults1) {
        const output =
          typeof result.data.result === "string"
            ? result.data.result
            : JSON.stringify(result.data);
        console.log(`[session-disabled] search_tools result: ${output}`);
        for (const tool of invoiceTools) {
          expect(output).not.toContain(`${INVOICE_PREFIX}${tool.name}`);
        }
      }

      const allToolCalls1 = stream1.events.filter(
        (e) => e.event === "tool-call",
      );
      console.log(
        `[session-disabled] All tool calls (${allToolCalls1.length}):`,
        allToolCalls1.map((e) => e.data.toolName),
      );

      stream1.cancel();

      // ---- Phase 2: Enable invoice extension on same task → continue the session → invoice tools found ----

      await updateTaskExtension(taskId, invoiceExt!.id, {
        enabled: true,
        toolPermissions: invoiceToolPerms,
      });

      const taskExts2 = await listTaskExtensions(taskId);
      const taskInvoice2 = taskExts2.find((e) => e.prefix === INVOICE_PREFIX);
      expect(taskInvoice2).toBeDefined();
      expect(taskInvoice2!.enabled).toBe(true);
      console.log("Enabled invoice extension on same task, continuing session");

      // Continue the existing session with a follow-up message
      const stream2 = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-session-toggle-enabled",
      });

      // Wait for SSE connection to be established before sending message.
      // The "status" event is sent AFTER the RabbitMQ subscription is active,
      // so this ensures no events are lost due to the subscription race.
      await stream2.waitForEvent("status");

      await sendSessionMessage(
        sessionId,
        "IMPORTANT: The available tools have been updated since your last message. The search_tools tool is NOW AVAILABLE. You MUST call search_tools with query 'invoice' right now. Do not assume it is unavailable based on previous errors. Do not ask any questions.",
      );

      await stream2.waitForDone();

      const searchCalls2 = stream2.events.filter(
        (e) => e.event === "tool-call" && e.data.toolName === "search_tools",
      );
      expect(searchCalls2.length).toBeGreaterThanOrEqual(1);
      console.log(
        `[session-enabled] search_tools calls: ${searchCalls2.length}`,
      );

      const searchResults2 = stream2.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "search_tools",
      );
      expect(searchResults2.length).toBeGreaterThanOrEqual(1);

      let foundInvoiceTool = false;
      for (const result of searchResults2) {
        const output =
          typeof result.data.result === "string"
            ? result.data.result
            : JSON.stringify(result.data);
        console.log(`[session-enabled] search_tools result: ${output}`);
        for (const tool of invoiceTools) {
          if (
            output.includes(`${INVOICE_PREFIX}${tool.name}`) ||
            output.includes(tool.name)
          ) {
            foundInvoiceTool = true;
          }
        }
      }
      expect(foundInvoiceTool).toBe(true);
      console.log(
        "[session-enabled] Invoice tools found in search_tools results (same session)",
      );

      const allToolCalls2 = stream2.events.filter(
        (e) => e.event === "tool-call",
      );
      console.log(
        `[session-enabled] All tool calls (${allToolCalls2.length}):`,
        allToolCalls2.map((e) => e.data.toolName),
      );

      stream2.cancel();
    } finally {
      await deleteTask(taskId);
      console.log(`Deleted task ${taskId}`);
    }
  });
});
