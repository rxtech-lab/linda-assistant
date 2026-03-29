import { test as base, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  updateAssigneePermissions,
  createTask,
  deleteTask,
  getTaskTools,
  getTaskExtensionDetail,
  updateTaskPermissions,
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
  tools?: Array<{ name: string; description: string }>;
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

async function updateTask(
  taskId: string,
  body: Record<string, unknown>,
): Promise<any> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `PUT /api/tasks/${taskId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
}

const INVOICE_PREFIX = "invoice_";

// Fixture: each test gets its own assignee
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(
      `e2e-task-tool-perm-${testInfo.testId}`,
    );
    console.log(`Created assignee ${id} for: ${testInfo.title}`);
    await use(id);
    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe("Task tool permissions via API", () => {
  test.setTimeout(120_000);

  test("system tool: direct API permission update reflected in task tools API", async ({
    assigneeId,
  }) => {
    // Create a task (inherits default permissions from assignee)
    const taskId = await createTask(
      assigneeId,
      "System Tool Permission Test",
      "Test task for permission verification.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Verify initial state: get_current_time should be manual-confirm
      const toolsBefore = await getTaskTools(taskId);
      const timeBefore = toolsBefore.find(
        (t) => t.name === "get_current_time",
      );
      expect(timeBefore).toBeDefined();
      expect(timeBefore!.defaultPermission).toBe("manual-confirm");
      console.log(
        "Initial get_current_time permission:",
        timeBefore!.defaultPermission,
      );

      // Update task permission: set get_current_time to auto-confirm
      await updateTaskPermissions(taskId, [
        { toolName: "get_current_time", permission: "auto-confirm" },
      ]);
      console.log("Updated get_current_time to auto-confirm");

      // Verify: task tools API reflects the change
      const toolsAfter = await getTaskTools(taskId);
      const timeAfter = toolsAfter.find(
        (t) => t.name === "get_current_time",
      );
      expect(timeAfter).toBeDefined();
      expect(timeAfter!.defaultPermission).toBe("auto-confirm");
      console.log(
        "After update, get_current_time permission:",
        timeAfter!.defaultPermission,
      );
    } finally {
      await deleteTask(taskId);
    }
  });

  test("extension tool: extension-level permission update reflected in extension detail API", async ({
    assigneeId,
  }) => {
    // Enable invoice extension on assignee
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    // Discover invoice tool names
    const extDetails = await getExtension(invoiceExt!.id);
    expect(extDetails.tools).toBeDefined();
    expect(extDetails.tools!.length).toBeGreaterThan(0);
    const firstToolName = extDetails.tools![0]!.name;

    // Enable extension on assignee with default permissions
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
    });

    // Create a task (inherits enabled extension)
    const taskId = await createTask(
      assigneeId,
      "Extension Tool Permission Test",
      "Test task for extension tool permission verification.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Verify task has lazy MCP tools (search_tools, read_tool, use_tool)
      const toolsBefore = await getTaskTools(taskId);
      const lazyToolNames = toolsBefore.map((t) => t.name);
      expect(lazyToolNames).toContain("search_tools");
      expect(lazyToolNames).toContain("read_tool");
      expect(lazyToolNames).toContain("use_tool");

      // Verify initial extension detail permission is manual-confirm
      const extDetailBefore = await getTaskExtensionDetail(taskId, invoiceExt!.id);
      const toolBefore = extDetailBefore.tools.find(
        (t) => t.name === firstToolName,
      );
      expect(toolBefore).toBeDefined();
      expect(toolBefore!.effectivePermission).toBe("manual-confirm");

      // Update task extension permissions: set first tool to auto-confirm
      await updateTaskExtension(taskId, invoiceExt!.id, {
        enabled: true,
        toolPermissions: [
          { toolName: firstToolName, permission: "auto-confirm" },
        ],
      });
      console.log(
        `Updated ${firstToolName} to auto-confirm via task extension`,
      );

      // Verify: extension detail API reflects effectivePermission
      const extDetail = await getTaskExtensionDetail(taskId, invoiceExt!.id);
      const targetExtTool = extDetail.tools.find(
        (t) => t.name === firstToolName,
      );
      expect(targetExtTool).toBeDefined();
      expect(targetExtTool!.effectivePermission).toBe("auto-confirm");
      console.log(
        "Extension detail API confirms effectivePermission is auto-confirm",
      );
    } finally {
      await deleteTask(taskId);
    }
  });

  test("extension tool: task-level permission override reflected in extension detail API", async ({
    assigneeId,
  }) => {
    // Enable invoice extension on assignee
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    // Discover invoice tool names
    const extDetails = await getExtension(invoiceExt!.id);
    expect(extDetails.tools).toBeDefined();
    expect(extDetails.tools!.length).toBeGreaterThan(0);
    const firstToolName = extDetails.tools![0]!.name;
    const prefixedName = `${INVOICE_PREFIX}${firstToolName}`;

    // Enable extension on assignee
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
    });

    // Create a task (inherits enabled extension)
    const taskId = await createTask(
      assigneeId,
      "Task-Level Extension Permission Test",
      "Test task for task-level extension tool permission override.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Verify initial extension detail shows manual-confirm
      const extDetailBefore = await getTaskExtensionDetail(
        taskId,
        invoiceExt!.id,
      );
      const toolBefore = extDetailBefore.tools.find(
        (t) => t.name === firstToolName,
      );
      expect(toolBefore).toBeDefined();
      expect(toolBefore!.effectivePermission).toBe("manual-confirm");
      console.log(
        "Initial effectivePermission:",
        toolBefore!.effectivePermission,
      );

      // Update task-level permissions with PREFIXED tool name
      await updateTask(taskId, {
        toolPermissions: [
          { toolName: prefixedName, permission: "auto-confirm" },
        ],
      });
      console.log(`Updated task toolPermissions: ${prefixedName} = auto-confirm`);

      // Verify: extension detail API reflects effectivePermission
      const extDetailAfter = await getTaskExtensionDetail(
        taskId,
        invoiceExt!.id,
      );
      const toolAfter = extDetailAfter.tools.find(
        (t) => t.name === firstToolName,
      );
      expect(toolAfter).toBeDefined();
      expect(toolAfter!.effectivePermission).toBe("auto-confirm");
      console.log(
        "Extension detail API confirms effectivePermission is auto-confirm after task-level override",
      );
    } finally {
      await deleteTask(taskId);
    }
  });
});
