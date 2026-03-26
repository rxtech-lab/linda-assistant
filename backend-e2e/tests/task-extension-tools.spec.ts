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
    // Ensure invoice extension is NOT enabled on the assignee
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    if (invoiceExt!.enabled) {
      await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
        enabled: false,
      });
    }

    // Create a task
    const taskId = await createTask(
      assigneeId,
      "Invoice Extension Test - Task Enabled",
      "List all invoices. Use the invoice tools to search or list invoices. Do not ask any questions.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Enable the invoice extension on the task
      await updateTaskExtension(taskId, invoiceExt!.id, { enabled: true });

      // Verify task extension is enabled
      const taskExts = await listTaskExtensions(taskId);
      const taskInvoiceExt = taskExts.find((e) => e.prefix === INVOICE_PREFIX);
      expect(taskInvoiceExt).toBeDefined();
      expect(taskInvoiceExt!.enabled).toBe(true);

      // Verify assignee extension is still disabled
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

      // Verify: invoice-prefixed tool calls should appear
      const invoiceToolCalls = stream.events.filter(
        (e) =>
          e.event === "tool-call" &&
          typeof e.data.toolName === "string" &&
          e.data.toolName.startsWith(INVOICE_PREFIX),
      );
      expect(invoiceToolCalls.length).toBeGreaterThanOrEqual(1);
      console.log(
        `Found ${invoiceToolCalls.length} invoice tool calls:`,
        invoiceToolCalls.map((e) => e.data.toolName),
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

      // Verify: NO invoice-prefixed tool calls should appear
      const invoiceToolCalls = stream.events.filter(
        (e) =>
          e.event === "tool-call" &&
          typeof e.data.toolName === "string" &&
          e.data.toolName.startsWith(INVOICE_PREFIX),
      );
      expect(invoiceToolCalls).toHaveLength(0);
      console.log("No invoice tool calls found (expected)");

      stream.cancel();
    } finally {
      await deleteTask(taskId);
    }
  });
});
