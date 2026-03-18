import { test, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  updateAssigneePermissions,
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

// ---- Task helpers ----

async function createTask(body: Record<string, unknown>): Promise<any> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/tasks failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
}

async function getTask(taskId: string): Promise<any> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/tasks/${taskId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
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

async function deleteTask(taskId: string): Promise<void> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `DELETE /api/tasks/${taskId} failed (${res.status})`,
    );
  }
}

// ---- Task extensions helpers ----

interface ExtensionWithStatus {
  id: string;
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
  const res = await fetch(
    `${BASE_URL}/api/tasks/${taskId}/extensions`,
    {
      headers: authHeaders(token),
    },
  );
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

test.describe("Task toolsets and extensions", () => {
  test.describe.configure({ mode: "serial" });

  let assigneeId: string;
  let taskId: string;
  let systemExtensionId: string;

  test.beforeAll(async () => {
    await ensureOnboarded();
    assigneeId = await createAssignee("task-toolset-test");
  });

  test.afterAll(async () => {
    if (taskId) {
      await deleteTask(taskId).catch(() => {});
    }
    if (assigneeId) {
      await deleteAssignee(assigneeId);
    }
  });

  test("task creation via API inherits tool permissions from assignee", async () => {
    // Set custom permissions on the assignee
    const assignee = await getAssignee(assigneeId);
    const customPermissions = assignee.toolPermissions.map(
      (tp: { toolName: string; permission: string }) => ({
        toolName: tp.toolName,
        permission:
          tp.toolName === "create_task" ? "auto-confirm" : tp.permission,
      }),
    );
    await updateAssigneePermissions(assigneeId, customPermissions);

    // Enable a system extension on the assignee
    const assigneeExtensions = await listAssigneeExtensions(assigneeId);
    const systemExt = assigneeExtensions.find((e) => e.type === "system");
    expect(systemExt).toBeDefined();
    systemExtensionId = systemExt!.id;

    await updateAssigneeExtension(assigneeId, systemExtensionId, {
      enabled: true,
    });

    // Create a task with this assignee
    const created = await createTask({
      title: "Toolset Inheritance Test",
      description: "Testing that task inherits assignee toolset",
      assigneeId,
    });
    taskId = created.id;

    // Verify task has tool permissions from assignee
    const task = await getTask(taskId);
    expect(task.toolPermissions).toBeDefined();
    expect(Array.isArray(task.toolPermissions)).toBe(true);

    // The inherited permissions should include the custom create_task auto-confirm
    const createTaskPerm = task.toolPermissions.find(
      (tp: { toolName: string }) => tp.toolName === "create_task",
    );
    expect(createTaskPerm).toBeDefined();
    expect(createTaskPerm.permission).toBe("auto-confirm");

    // Verify task extensions were inherited
    const taskExts = await listTaskExtensions(taskId);
    const inheritedExt = taskExts.find((e) => e.id === systemExtensionId);
    expect(inheritedExt).toBeDefined();
    expect(inheritedExt!.enabled).toBe(true);

    // Verify task detail includes enabledExtensions
    expect(task.enabledExtensions).toBeDefined();
    expect(Array.isArray(task.enabledExtensions)).toBe(true);
    expect(task.enabledExtensions.length).toBeGreaterThanOrEqual(1);
    const enabledExt = task.enabledExtensions.find(
      (e: { id: string }) => e.id === systemExtensionId,
    );
    expect(enabledExt).toBeDefined();
  });

  test("updating assignee does NOT update task toolset", async () => {
    // Get current task permissions
    const taskBefore = await getTask(taskId);
    const permsBefore = taskBefore.toolPermissions;

    // Update assignee permissions to something different
    const assignee = await getAssignee(assigneeId);
    const newPermissions = assignee.toolPermissions.map(
      (tp: { toolName: string; permission: string }) => ({
        toolName: tp.toolName,
        permission: "manual-confirm",
      }),
    );
    await updateAssigneePermissions(assigneeId, newPermissions);

    // Disable the extension on the assignee
    await updateAssigneeExtension(assigneeId, systemExtensionId, {
      enabled: false,
    });

    // Verify task toolset is unchanged
    const taskAfter = await getTask(taskId);
    expect(taskAfter.toolPermissions).toEqual(permsBefore);

    // Task extensions should still show the extension as enabled
    const taskExts = await listTaskExtensions(taskId);
    const inheritedExt = taskExts.find((e) => e.id === systemExtensionId);
    expect(inheritedExt).toBeDefined();
    expect(inheritedExt!.enabled).toBe(true);
  });

  test("can update task toolset permissions via API", async () => {
    const task = await getTask(taskId);
    const updatedPermissions = task.toolPermissions.map(
      (tp: { toolName: string; permission: string }) => ({
        toolName: tp.toolName,
        permission:
          tp.toolName === "send_email" ? "auto-reject" : tp.permission,
      }),
    );

    const updated = await updateTask(taskId, {
      toolPermissions: updatedPermissions,
    });

    expect(updated.toolPermissions).toBeDefined();
    const sendEmailPerm = updated.toolPermissions.find(
      (tp: { toolName: string }) => tp.toolName === "send_email",
    );
    expect(sendEmailPerm).toBeDefined();
    expect(sendEmailPerm.permission).toBe("auto-reject");

    // Verify via GET
    const fetched = await getTask(taskId);
    const fetchedPerm = fetched.toolPermissions.find(
      (tp: { toolName: string }) => tp.toolName === "send_email",
    );
    expect(fetchedPerm.permission).toBe("auto-reject");
  });

  test("can update task extension settings via API", async () => {
    // Disable extension on task
    const updated = await updateTaskExtension(taskId, systemExtensionId, {
      enabled: false,
    });
    expect(updated.enabled).toBe(false);

    // Verify via list
    const taskExts = await listTaskExtensions(taskId);
    const disabledExt = taskExts.find((e) => e.id === systemExtensionId);
    expect(disabledExt).toBeDefined();
    expect(disabledExt!.enabled).toBe(false);

    // Re-enable with custom tool permissions
    const reEnabled = await updateTaskExtension(taskId, systemExtensionId, {
      enabled: true,
      toolPermissions: [
        { toolName: "test_tool", permission: "auto-confirm" },
      ],
    });
    expect(reEnabled.enabled).toBe(true);

    // Verify custom permissions persisted
    const taskExtsAfter = await listTaskExtensions(taskId);
    const reEnabledExt = taskExtsAfter.find(
      (e) => e.id === systemExtensionId,
    );
    expect(reEnabledExt).toBeDefined();
    expect(reEnabledExt!.enabled).toBe(true);
    expect(reEnabledExt!.toolPermissions).toEqual([
      { toolName: "test_tool", permission: "auto-confirm" },
    ]);
  });

  test("GET task detail returns toolPermissions and enabledExtensions", async () => {
    const task = await getTask(taskId);

    // Check toolPermissions
    expect(task.toolPermissions).toBeDefined();
    expect(Array.isArray(task.toolPermissions)).toBe(true);
    expect(task.toolPermissions.length).toBeGreaterThan(0);

    // Each permission should have correct shape
    for (const perm of task.toolPermissions) {
      expect(perm).toHaveProperty("toolName");
      expect(perm).toHaveProperty("permission");
      expect(typeof perm.toolName).toBe("string");
      expect([
        "auto-confirm",
        "manual-confirm",
        "auto-reject",
        "disabled",
      ]).toContain(perm.permission);
    }

    // Check enabledExtensions
    expect(task.enabledExtensions).toBeDefined();
    expect(Array.isArray(task.enabledExtensions)).toBe(true);

    // The system extension should be in enabled list (we re-enabled it in the previous test)
    const enabledExt = task.enabledExtensions.find(
      (e: { id: string }) => e.id === systemExtensionId,
    );
    expect(enabledExt).toBeDefined();
    expect(enabledExt).toHaveProperty("id");
    expect(enabledExt).toHaveProperty("title");
    expect(enabledExt).toHaveProperty("prefix");
  });

  test("GET task/:id/extensions returns all extensions with enabled info", async () => {
    const taskExts = await listTaskExtensions(taskId);

    // Should have at least the system extensions
    expect(taskExts.length).toBeGreaterThan(0);

    // Each extension should have the correct shape
    for (const ext of taskExts) {
      expect(ext).toHaveProperty("id");
      expect(ext).toHaveProperty("title");
      expect(ext).toHaveProperty("prefix");
      expect(ext).toHaveProperty("enabled");
      expect(typeof ext.enabled).toBe("boolean");
    }

    // The system extension we configured should be present with correct state
    const configuredExt = taskExts.find((e) => e.id === systemExtensionId);
    expect(configuredExt).toBeDefined();
    expect(configuredExt!.enabled).toBe(true);

    // Other extensions (not configured for this task) should default to disabled
    const otherExts = taskExts.filter((e) => e.id !== systemExtensionId);
    for (const ext of otherExts) {
      expect(ext.enabled).toBe(false);
    }
  });
});
