import { test as base, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  updateAssigneePermissions,
  createTask,
  deleteTask,
  getTaskExtensionDetail,
  getAssigneeExtensionDetail,
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

const INVOICE_PREFIX = "invoice_";

// Fixture: each test gets its own assignee
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(
      `e2e-ext-perm-${testInfo.testId}`,
    );
    console.log(`Created assignee ${id} for: ${testInfo.title}`);
    await use(id);
    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe("Extension permission resolution", () => {
  test.setTimeout(120_000);

  test("assignee extension detail shows effectivePermission from extension-level setting", async ({
    assigneeId,
  }) => {
    // Find invoice extension
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    // Discover invoice tool names
    const extDetails = await getExtension(invoiceExt!.id);
    expect(extDetails.tools).toBeDefined();
    expect(extDetails.tools!.length).toBeGreaterThan(0);
    const firstToolName = extDetails.tools![0]!.name;

    // Enable extension with auto-confirm for the first tool (unprefixed name)
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
      toolPermissions: [
        { toolName: firstToolName, permission: "auto-confirm" },
      ],
    });
    console.log(`Set ${firstToolName} to auto-confirm at extension level`);

    // Verify: assignee extension detail shows effectivePermission
    const detail = await getAssigneeExtensionDetail(assigneeId, invoiceExt!.id);
    const tool = detail.tools.find((t) => t.name === firstToolName);
    expect(tool).toBeDefined();
    expect(tool!.effectivePermission).toBe("auto-confirm");
    console.log(
      `Assignee extension detail: ${firstToolName} effectivePermission = ${tool!.effectivePermission}`,
    );
  });

  test("assignee extension detail resolves effectivePermission from assignee-level setting", async ({
    assigneeId,
  }) => {
    // Find invoice extension
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    // Discover invoice tool names
    const extDetails = await getExtension(invoiceExt!.id);
    expect(extDetails.tools).toBeDefined();
    expect(extDetails.tools!.length).toBeGreaterThan(0);
    const firstToolName = extDetails.tools![0]!.name;
    const prefixedName = `${INVOICE_PREFIX}${firstToolName}`;

    // Enable extension (no extension-level tool permissions)
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
    });

    // Set permission at assignee level (prefixed name)
    const assignee = await getAssignee(assigneeId);
    const permissions = (assignee.toolPermissions ?? []).map((tp: any) => ({
      toolName: tp.toolName,
      permission: tp.toolName === prefixedName ? "auto-confirm" : tp.permission,
    }));
    // Ensure the prefixed tool is included
    if (!permissions.find((p: any) => p.toolName === prefixedName)) {
      permissions.push({ toolName: prefixedName, permission: "auto-confirm" });
    }
    await updateAssigneePermissions(assigneeId, permissions);
    console.log(`Set ${prefixedName} to auto-confirm at assignee level`);

    // Verify: assignee extension detail resolves from assignee-level
    const detail = await getAssigneeExtensionDetail(assigneeId, invoiceExt!.id);
    const tool = detail.tools.find((t) => t.name === firstToolName);
    expect(tool).toBeDefined();
    expect(tool!.effectivePermission).toBe("auto-confirm");
    console.log(
      `Assignee extension detail: ${firstToolName} effectivePermission = ${tool!.effectivePermission}`,
    );
  });

  test("task extension detail inherits effectivePermission from assignee extension setting", async ({
    assigneeId,
  }) => {
    // Find and enable invoice extension with auto-confirm
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    const extDetails = await getExtension(invoiceExt!.id);
    expect(extDetails.tools).toBeDefined();
    const firstToolName = extDetails.tools![0]!.name;

    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
      toolPermissions: [
        { toolName: firstToolName, permission: "auto-confirm" },
      ],
    });

    // Create task (inherits extension settings from assignee)
    const taskId = await createTask(
      assigneeId,
      "Ext Permission Inheritance Test",
      "Test task for permission inheritance.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Verify: task extension detail shows inherited effectivePermission
      const detail = await getTaskExtensionDetail(taskId, invoiceExt!.id);
      const tool = detail.tools.find((t) => t.name === firstToolName);
      expect(tool).toBeDefined();
      expect(tool!.effectivePermission).toBe("auto-confirm");
      console.log(
        `Task extension detail: ${firstToolName} effectivePermission = ${tool!.effectivePermission}`,
      );
    } finally {
      await deleteTask(taskId);
    }
  });

  test("task extension detail falls back to assignee permission set after task creation", async ({
    assigneeId,
  }) => {
    // Find invoice extension
    const assigneeExts = await listAssigneeExtensions(assigneeId);
    const invoiceExt = assigneeExts.find((e) => e.prefix === INVOICE_PREFIX);
    expect(invoiceExt).toBeDefined();

    const extDetails = await getExtension(invoiceExt!.id);
    expect(extDetails.tools).toBeDefined();
    const firstToolName = extDetails.tools![0]!.name;

    // Enable extension without any tool permissions
    await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
      enabled: true,
    });

    // Create task BEFORE setting any permissions
    const taskId = await createTask(
      assigneeId,
      "Post-Creation Permission Test",
      "Test task for post-creation permission fallback.",
    );
    console.log(`Created task ${taskId}`);

    try {
      // Verify initial: effectivePermission should be manual-confirm
      const detailBefore = await getTaskExtensionDetail(taskId, invoiceExt!.id);
      const toolBefore = detailBefore.tools.find((t) => t.name === firstToolName);
      expect(toolBefore).toBeDefined();
      expect(toolBefore!.effectivePermission).toBe("manual-confirm");
      console.log(
        `Before: ${firstToolName} effectivePermission = ${toolBefore!.effectivePermission}`,
      );

      // Now set assignee extension permission AFTER task creation
      await updateAssigneeExtension(assigneeId, invoiceExt!.id, {
        enabled: true,
        toolPermissions: [
          { toolName: firstToolName, permission: "auto-confirm" },
        ],
      });
      console.log(`Set ${firstToolName} to auto-confirm at assignee extension level (after task creation)`);

      // Verify: task extension detail falls back to current assignee extension permissions
      const detailAfter = await getTaskExtensionDetail(taskId, invoiceExt!.id);
      const toolAfter = detailAfter.tools.find((t) => t.name === firstToolName);
      expect(toolAfter).toBeDefined();
      expect(toolAfter!.effectivePermission).toBe("auto-confirm");
      console.log(
        `After: ${firstToolName} effectivePermission = ${toolAfter!.effectivePermission}`,
      );
    } finally {
      await deleteTask(taskId);
    }
  });
});
