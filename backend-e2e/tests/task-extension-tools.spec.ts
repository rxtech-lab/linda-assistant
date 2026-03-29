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
  consumeStream,
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

async function listAssigneeExtensions(
  assigneeId: string,
): Promise<ExtensionWithStatus[]> {
  const token = loadToken();
  const res = await fetch(
    `${BASE_URL}/api/assignees/${assigneeId}/extensions`,
    {
      headers: authHeaders(token),
    },
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

async function getExtension(
  extensionId: string,
): Promise<ExtensionWithStatus & { tools?: Array<{ name: string; description: string }> }> {
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

// Fixture: each test gets its own assignee
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(
      `e2e-task-ext-tools-${testInfo.testId}`,
    );
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Set all tools to auto-confirm for simplicity
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

test.describe.serial("Task extension tools isolation", () => {
  test.setTimeout(300_000);

  test("task with invoice extension enabled but assignee disabled — task can use invoice tools", async ({
    assigneeId,
  }) => {
    // First, enable the invoice extension on the assignee so the task inherits it with tools
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    // Discover invoice tool names and enable with auto-confirm
    const extDetails = await getExtension(invoiceExt!.id);
    const invoiceToolPerms = (extDetails.tools ?? []).map((t) => ({
      toolName: t.name,
      permission: "auto-confirm",
    }));
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
      toolPermissions: invoiceToolPerms,
    });
    console.log(
      "Enabled invoice extension on assignee with auto-confirm for tools:",
      invoiceToolPerms.map((p) => p.toolName),
    );

    // Create a task (inherits enabled invoice extension from assignee)
    const taskId = await createTask(
      assigneeId,
      "Invoice Extension Test - Task Enabled",
      "List all invoices. Use the invoice tools to search or list invoices. Do not ask any questions.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Now disable the invoice extension on the assignee
      await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
        enabled: false,
      });

      // Verify task extension is still enabled (inherited, independent of assignee)
      const taskExts = await listTaskExtensions(taskId);
      const taskInvoiceExt = taskExts.find((e) => e.prefix === INVOICE_PREFIX);
      expect(taskInvoiceExt).toBeDefined();
      expect(taskInvoiceExt!.enabled).toBe(true);

      // Verify assignee extension is now disabled
      const assigneeExtsAfter = await listAssigneeExtensions(assigneeId);
      const assigneeInvoiceAfter = assigneeExtsAfter.find(
        (e) => e.prefix === INVOICE_PREFIX,
      );
      expect(assigneeInvoiceAfter!.enabled).toBe(false);

      // Execute the task
      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-ext-enabled",
      });

      await stream.waitForDone();

      // Log all events for diagnostics
      const allToolCalls = stream.events.filter(
        (e) => e.event === "tool-call",
      );
      console.log(
        `All tool-call events (${allToolCalls.length}):`,
        allToolCalls.map((e) => e.data.toolName),
      );

      // With lazy MCP loading, the agent uses search_tools/read_tool/use_tool
      // instead of calling invoice_* tools directly.
      // Verify the agent used the lazy tool flow to interact with invoice tools.
      const useToolCalls = stream.events.filter(
        (e) =>
          e.event === "tool-call" &&
          e.data.toolName === "use_tool",
      );
      const invoiceUseToolCalls = useToolCalls.filter((e) => {
        const input = e.data.input as Record<string, unknown> | undefined;
        return (
          typeof input?.toolId === "string" &&
          input.toolId.startsWith(INVOICE_PREFIX)
        );
      });
      expect(invoiceUseToolCalls.length).toBeGreaterThanOrEqual(1);
      console.log(
        `Found ${invoiceUseToolCalls.length} invoice use_tool calls:`,
        invoiceUseToolCalls.map(
          (e) => (e.data.input as Record<string, unknown>)?.toolId,
        ),
      );

      stream.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });

  test("task with invoice extension disabled but assignee enabled — task cannot use invoice tools", async ({
    assigneeId,
  }) => {
    // Enable invoice extension on the assignee
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
    });

    // Create a task (inherits enabled invoice extension from assignee)
    const taskId = await createTask(
      assigneeId,
      "Invoice Extension Test - Task Disabled",
      "List all invoices. Use the invoice tools to search or list invoices. Do not ask any questions.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Disable the invoice extension on the task
      await updateTaskExtension(taskId, invoiceExt!.id, { enabled: false });

      // Verify task extension is disabled
      const taskExts = await listTaskExtensions(taskId);
      const taskInvoiceExt = taskExts.find((e) => e.prefix === INVOICE_PREFIX);
      expect(taskInvoiceExt).toBeDefined();
      expect(taskInvoiceExt!.enabled).toBe(false);

      // Verify assignee extension is still enabled
      const assigneeExtsAfter = await listAssigneeExtensions(assigneeId);
      const assigneeInvoiceAfter = assigneeExtsAfter.find(
        (e) => e.prefix === INVOICE_PREFIX,
      );
      expect(assigneeInvoiceAfter!.enabled).toBe(true);

      // Execute the task
      const { sessionId } = await executeTaskNow(taskId);
      console.log(`Task executed, session: ${sessionId}`);

      const stream = consumeSessionStream(sessionId, {
        timeout: 180_000,
        label: "task-ext-disabled",
      });

      await stream.waitForDone();

      // With lazy loading, when extension is disabled for the task, the lazy tools
      // should not discover any invoice tools. Verify no use_tool calls target invoice tools.
      const useToolCalls = stream.events.filter(
        (e) =>
          e.event === "tool-call" &&
          e.data.toolName === "use_tool",
      );
      const invoiceUseToolCalls = useToolCalls.filter((e) => {
        const input = e.data.input as Record<string, unknown> | undefined;
        return (
          typeof input?.toolId === "string" &&
          input.toolId.startsWith(INVOICE_PREFIX)
        );
      });
      expect(invoiceUseToolCalls).toHaveLength(0);
      console.log("No invoice use_tool calls found (expected)");

      stream.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });
});

test.describe.serial("Chat extension tools (regular chat)", () => {
  test.setTimeout(300_000);

  test("regular chat with invoice extension enabled — agent can use invoice tools", async ({
    assigneeId,
  }) => {
    // Enable invoice extension on the assignee with auto-confirm
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    const extDetails = await getExtension(invoiceExt!.id);
    const invoiceToolPerms = (extDetails.tools ?? []).map((t) => ({
      toolName: t.name,
      permission: "auto-confirm",
    }));
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
      toolPermissions: invoiceToolPerms,
    });
    console.log(
      "Enabled invoice extension on assignee with auto-confirm for tools:",
      invoiceToolPerms.map((p) => p.toolName),
    );

    // Start SSE stream for the assignee chat
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "chat-ext-enabled",
    });

    try {
      // Send a chat message asking to use invoice tools
      await sendMessage(
        assigneeId,
        "List all invoices. Use the invoice tools to search or list invoices. Do not ask any questions.",
      );

      await stream.waitForDone();

      // Log all tool calls for debugging
      const allToolCalls = stream.events.filter(
        (e) => e.event === "tool-call",
      );
      console.log(
        `[chat-ext-enabled] All tool calls (${allToolCalls.length}):`,
        allToolCalls.map((e) => e.data.toolName),
      );

      // With lazy MCP loading, the agent uses use_tool to call invoice tools.
      // Verify use_tool was called with an invoice-prefixed toolId.
      const useToolCalls = stream.events.filter(
        (e) =>
          e.event === "tool-call" &&
          e.data.toolName === "use_tool",
      );
      const invoiceUseToolCalls = useToolCalls.filter((e) => {
        const input = e.data.input as Record<string, unknown> | undefined;
        return (
          typeof input?.toolId === "string" &&
          input.toolId.startsWith(INVOICE_PREFIX)
        );
      });
      expect(invoiceUseToolCalls.length).toBeGreaterThanOrEqual(1);
      console.log(
        `Found ${invoiceUseToolCalls.length} invoice use_tool calls:`,
        invoiceUseToolCalls.map(
          (e) => (e.data.input as Record<string, unknown>)?.toolId,
        ),
      );
    } finally {
      stream.cancel();
    }
  });
});
