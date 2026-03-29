import { test, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import { createAssignee, deleteAssignee } from "./chat.utils";
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

async function getTools(
  assigneeId: string,
): Promise<{
  body: Array<{ name: string; description: string; defaultPermission: string }>;
  cacheHeader: string | null;
}> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tools?assigneeId=${assigneeId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/tools failed (${res.status}): ${await res.text()}`,
    );
  }
  return {
    body: (await res.json()) as Array<{
      name: string;
      description: string;
      defaultPermission: string;
    }>,
    cacheHeader: res.headers.get("X-Cache"),
  };
}

interface ExtensionWithStatus {
  id: string;
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

async function getExtension(extensionId: string): Promise<ExtensionWithStatus> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/extensions/${extensionId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/extensions/${extensionId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return (await res.json()) as ExtensionWithStatus;
}

test.describe("Tools API", () => {
  test.describe.configure({ mode: "serial" });

  let assigneeId: string;

  test.beforeAll(async () => {
    await ensureOnboarded();
    assigneeId = await createAssignee("tools-test");
  });

  test.afterAll(async () => {
    if (assigneeId) {
      await deleteAssignee(assigneeId);
    }
  });

  test("returns tool list with cache MISS then HIT", async () => {
    // First call — cache miss
    const first = await getTools(assigneeId);

    expect(first.cacheHeader).toBe("MISS");
    expect(first.body.length).toBeGreaterThan(0);

    // Verify tool shape
    for (const tool of first.body) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("defaultPermission");
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect([
        "auto-confirm",
        "manual-confirm",
        "auto-reject",
        "disabled",
      ]).toContain(tool.defaultPermission);
    }

    // Second call — cache hit
    const second = await getTools(assigneeId);

    expect(second.cacheHeader).toBe("HIT");
    expect(second.body).toEqual(first.body);
  });
});

test.describe("Extension Enable/Disable Tool Availability", () => {
  test.describe.configure({ mode: "serial" });

  let assigneeId: string;
  let extensionId: string;
  let extensionPrefix: string;
  let baselineToolNames: string[];

  test.beforeAll(async () => {
    await ensureOnboarded();
    assigneeId = await createAssignee("ext-tools-test");
  });

  test.afterAll(async () => {
    if (assigneeId) {
      // Disable the extension before cleanup to leave a clean state
      if (extensionId) {
        await updateAssigneeExtension(assigneeId, extensionId, {
          enabled: false,
        }).catch(() => {});
      }
      await deleteAssignee(assigneeId);
    }
  });

  test("disabled extension tools are not in assignee tools", async () => {
    // List extensions and find a system extension
    const extensions = await listAssigneeExtensions(assigneeId);
    expect(extensions.length).toBeGreaterThan(0);

    const systemExt = extensions.find((e) => e.type === "system");
    expect(systemExt).toBeDefined();
    extensionId = systemExt!.id;
    extensionPrefix = systemExt!.prefix;

    // Verify it's disabled by default
    expect(systemExt!.enabled).toBe(false);

    // Get baseline tool list — lazy tools (search_tools, read_tool, use_tool) should NOT be present
    const { body: baselineTools } = await getTools(assigneeId);
    baselineToolNames = baselineTools.map((t) => t.name);

    // Confirm no lazy MCP tools exist (no extensions enabled)
    expect(baselineToolNames).not.toContain("search_tools");
    expect(baselineToolNames).not.toContain("read_tool");
    expect(baselineToolNames).not.toContain("use_tool");
  });

  test("enabled extension tools appear in assignee tools", async () => {
    // Enable the extension
    const updated = await updateAssigneeExtension(assigneeId, extensionId, {
      enabled: true,
    });
    expect(updated.enabled).toBe(true);

    // Get tools — should now include the 3 lazy MCP tools
    const { body: tools } = await getTools(assigneeId);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("search_tools");
    expect(toolNames).toContain("read_tool");
    expect(toolNames).toContain("use_tool");

    // Total tool count should be greater than baseline
    expect(tools.length).toBeGreaterThan(baselineToolNames.length);
  });

  test("disabling extension removes its tools", async () => {
    // Disable the extension
    const updated = await updateAssigneeExtension(assigneeId, extensionId, {
      enabled: false,
    });
    expect(updated.enabled).toBe(false);

    // Get tools — lazy MCP tools should be gone
    const { body: tools } = await getTools(assigneeId);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).not.toContain("search_tools");
    expect(toolNames).not.toContain("read_tool");
    expect(toolNames).not.toContain("use_tool");

    // Should be back to baseline count
    expect(tools.length).toBe(baselineToolNames.length);
  });

  test("re-enabling preserves custom tool permissions", async () => {
    // First, discover the extension's tool names
    const extDetails = await getExtension(extensionId);
    expect(extDetails.tools).toBeDefined();
    expect(extDetails.tools!.length).toBeGreaterThan(0);
    const firstToolName = extDetails.tools![0]!.name;

    // Enable extension with custom tool permissions
    const customPermissions = [
      { toolName: firstToolName, permission: "auto-confirm" },
    ];
    await updateAssigneeExtension(assigneeId, extensionId, {
      enabled: true,
      toolPermissions: customPermissions,
    });

    // Verify lazy tools appear
    const { body: toolsAfterEnable } = await getTools(assigneeId);
    const lazyToolNames = toolsAfterEnable.map((t) => t.name);
    expect(lazyToolNames).toContain("search_tools");
    expect(lazyToolNames).toContain("read_tool");
    expect(lazyToolNames).toContain("use_tool");

    // Disable extension → lazy tools disappear
    await updateAssigneeExtension(assigneeId, extensionId, { enabled: false });
    const { body: toolsAfterDisable } = await getTools(assigneeId);
    const namesAfterDisable = toolsAfterDisable.map((t) => t.name);
    expect(namesAfterDisable).not.toContain("search_tools");
    expect(namesAfterDisable).not.toContain("read_tool");
    expect(namesAfterDisable).not.toContain("use_tool");

    // Re-enable WITHOUT sending toolPermissions — they should be preserved
    await updateAssigneeExtension(assigneeId, extensionId, { enabled: true });

    // Check that toolPermissions are preserved in DB
    const extensionsAfterReEnable = await listAssigneeExtensions(assigneeId);
    const reEnabledExt = extensionsAfterReEnable.find(
      (e) => e.id === extensionId,
    );
    expect(reEnabledExt).toBeDefined();
    expect(reEnabledExt!.enabled).toBe(true);
    expect(reEnabledExt!.toolPermissions).toEqual(customPermissions);

    // Verify lazy tools appear again
    const { body: toolsAfterReEnable } = await getTools(assigneeId);
    const namesAfterReEnable = toolsAfterReEnable.map((t) => t.name);
    expect(namesAfterReEnable).toContain("search_tools");
    expect(namesAfterReEnable).toContain("read_tool");
    expect(namesAfterReEnable).toContain("use_tool");
  });
});
