import { test as base, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  updateAssigneePermissions,
  consumeStream,
  sendMessage,
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
): Promise<ExtensionWithStatus> {
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

async function getTools(
  assigneeId: string,
): Promise<{
  body: Array<{
    name: string;
    description: string;
    defaultPermission: string;
    disablePermissionChange?: boolean;
  }>;
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
      disablePermissionChange?: boolean;
    }>,
  };
}

// Fixture: each test gets its own assignee
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-lazy-mcp-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Set all system tools to auto-confirm
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

test.describe.serial("Lazy MCP Tools - Tool List", () => {
  test.setTimeout(120_000);

  test("lazy tools appear when extension enabled, absent when disabled", async ({
    assigneeId,
  }) => {
    // Before enabling any extension, lazy tools should NOT be present
    const { body: toolsBefore } = await getTools(assigneeId);
    const namesBefore = toolsBefore.map((t) => t.name);
    expect(namesBefore).not.toContain("search_tools");
    expect(namesBefore).not.toContain("read_tool");
    expect(namesBefore).not.toContain("use_tool");

    // Find and enable a system extension
    const extensions = await listAssigneeExtensions(assigneeId);
    const systemExt = extensions.find((e) => e.type === "system");
    expect(systemExt).toBeDefined();

    await updateAssigneeExtension(assigneeId, systemExt!.id, {
      enabled: true,
    });

    // After enabling, lazy tools SHOULD be present
    const { body: toolsAfter } = await getTools(assigneeId);
    const namesAfter = toolsAfter.map((t) => t.name);
    expect(namesAfter).toContain("search_tools");
    expect(namesAfter).toContain("read_tool");
    expect(namesAfter).toContain("use_tool");

    // They should have disablePermissionChange: true
    for (const name of ["search_tools", "read_tool", "use_tool"]) {
      const t = toolsAfter.find((tool) => tool.name === name);
      expect(t).toBeDefined();
      expect(t!.disablePermissionChange).toBe(true);
    }

    // No directly-prefixed extension tools should appear (lazy replaces them)
    const directMcpTools = namesAfter.filter((n) =>
      n.startsWith(systemExt!.prefix),
    );
    expect(directMcpTools).toHaveLength(0);

    // Disable extension
    await updateAssigneeExtension(assigneeId, systemExt!.id, {
      enabled: false,
    });

    // Lazy tools should be gone again
    const { body: toolsAfterDisable } = await getTools(assigneeId);
    const namesAfterDisable = toolsAfterDisable.map((t) => t.name);
    expect(namesAfterDisable).not.toContain("search_tools");
    expect(namesAfterDisable).not.toContain("read_tool");
    expect(namesAfterDisable).not.toContain("use_tool");
  });
});

test.describe.serial("Lazy MCP Tools - Agent Chat", () => {
  test.setTimeout(300_000);

  test("agent uses search_tools, read_tool, use_tool to interact with extension", async ({
    assigneeId,
  }) => {
    // Enable the extension and discover its actual tools
    const extensions = await listAssigneeExtensions(assigneeId);
    const systemExt = extensions.find((e) => e.type === "system");
    expect(systemExt).toBeDefined();
    await updateAssigneeExtension(assigneeId, systemExt!.id, {
      enabled: true,
    });

    // Get extension details to find an actual tool name
    const extDetails = await getExtension(systemExt!.id);
    const extTools = extDetails.tools ?? [];
    expect(extTools.length).toBeGreaterThan(0);
    const targetTool = extTools[0];
    console.log(
      `Extension "${systemExt!.title}" has ${extTools.length} tools, using "${targetTool.name}" for test`,
    );

    // Start listening on the SSE stream
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "lazy-mcp-agent",
    });

    try {
      // Send a message asking the agent to discover and use the actual tool
      await sendMessage(
        assigneeId,
        `Search for extension tools related to "${targetTool.name}", then read the tool details using read_tool, and finally use the tool "${targetTool.name}" with use_tool. Do not ask any questions, just do it step by step: first search_tools, then read_tool, then use_tool.`,
      );

      await stream.waitForDone();

      // Collect tool-call events
      const toolCalls = stream.events
        .filter((e) => e.event === "tool-call")
        .map((e) => e.data.toolName as string);

      console.log("Tool calls:", toolCalls);

      // The agent should have called search_tools
      expect(toolCalls).toContain("search_tools");

      // The agent should have called read_tool
      expect(toolCalls).toContain("read_tool");

      // The agent should have called use_tool
      expect(toolCalls).toContain("use_tool");

      // Verify no errors in tool results
      const toolResults = stream.events.filter(
        (e) => e.event === "tool-result",
      );
      for (const result of toolResults) {
        if (result.data.toolName === "use_tool") {
          expect(result.data.isError).toBeFalsy();
        }
      }
    } finally {
      stream.cancel();
    }
  });

  test("search_tools filters out disabled tools", async ({ assigneeId }) => {
    // Enable the extension and discover its actual tools
    const extensions = await listAssigneeExtensions(assigneeId);
    const systemExt = extensions.find((e) => e.type === "system");
    expect(systemExt).toBeDefined();

    // Get extension details to find an actual tool name to disable
    const extDetails = await getExtension(systemExt!.id);
    const extTools = extDetails.tools ?? [];
    expect(extTools.length).toBeGreaterThan(0);
    const disabledTool = extTools[0];
    console.log(`Disabling tool "${disabledTool.name}" for filter test`);

    await updateAssigneeExtension(assigneeId, systemExt!.id, {
      enabled: true,
      toolPermissions: [{ toolName: disabledTool.name, permission: "disabled" }],
    });

    // Clear history before this test
    await clearChatHistory(assigneeId);

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "lazy-mcp-disabled",
    });

    try {
      await sendMessage(
        assigneeId,
        `Search for extension tools related to "${disabledTool.name}" and tell me all the tool IDs you found. Do not ask questions.`,
      );

      await stream.waitForDone();

      // search_tools should have been called
      const searchCalls = stream.events.filter(
        (e) =>
          e.event === "tool-call" && e.data.toolName === "search_tools",
      );
      expect(searchCalls.length).toBeGreaterThanOrEqual(1);

      // Check the search results don't contain the disabled tool
      const searchResults = stream.events.filter(
        (e) =>
          e.event === "tool-result" && e.data.toolName === "search_tools",
      );

      for (const result of searchResults) {
        const output = result.data.output as Record<string, unknown> | undefined;
        if (output?.tools) {
          const tools = output.tools as Array<{ id: string; name: string }>;
          const found = tools.find(
            (t) => t.name === disabledTool.name || t.id === `${systemExt!.prefix}${disabledTool.name}`,
          );
          expect(found).toBeUndefined();
        }
      }
    } finally {
      stream.cancel();
    }
  });
});
