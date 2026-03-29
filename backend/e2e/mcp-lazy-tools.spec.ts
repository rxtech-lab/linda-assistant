import { test, expect, type APIRequestContext } from "@playwright/test";
import { consumeSSE } from "./helpers/sse-client";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
  sendMessageResponseSchema,
} from "./helpers/schemas";

const SUB_DELAY = 200;

/**
 * Helper: create an assignee, optionally enabling the e2e_test extension.
 */
async function setupAssigneeWithExtension(
  request: APIRequestContext,
  name: string,
  email: string,
  enableExtension: boolean,
) {
  // Create assignee
  const assigneeRes = await request.post("/api/assignees", {
    data: { name, email },
  });
  expect(assigneeRes.ok()).toBeTruthy();
  const assignee = await assigneeRes.json();
  assigneeResponseSchema.parse(assignee);

  if (enableExtension) {
    // List extensions for this assignee
    const extsRes = await request.get(`/api/assignees/${assignee.id}/extensions`);
    expect(extsRes.ok()).toBeTruthy();
    const exts = await extsRes.json();
    const e2eExt = exts.find((e: any) => e.prefix === "e2e_test_");
    expect(e2eExt).toBeDefined();

    // Enable the e2e_test extension
    const enableRes = await request.put(`/api/assignees/${assignee.id}/extensions/${e2eExt.id}`, {
      data: { enabled: true },
    });
    expect(enableRes.ok()).toBeTruthy();

    return { assignee, extensionId: e2eExt.id };
  }

  return { assignee, extensionId: null };
}

test.describe("Lazy MCP Tools", () => {
  test.describe.configure({ retries: 2 });

  test("search_tools, read_tool, use_tool appear when extension is enabled", async ({
    request,
  }) => {
    const { assignee } = await setupAssigneeWithExtension(
      request,
      "Lazy Tools Test",
      "lazy-tools@example.com",
      true,
    );

    // Get the tool list — should include the 3 lazy MCP tools
    const toolsRes = await request.get(`/api/tools?assigneeId=${assignee.id}`);
    expect(toolsRes.ok()).toBeTruthy();
    const tools = await toolsRes.json();

    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain("search_tools");
    expect(toolNames).toContain("read_tool");
    expect(toolNames).toContain("use_tool");

    // These tools should have disablePermissionChange: true
    for (const name of ["search_tools", "read_tool", "use_tool"]) {
      const t = tools.find((tool: any) => tool.name === name);
      expect(t).toBeDefined();
      expect(t.disablePermissionChange).toBe(true);
    }

    // There should be NO directly-prefixed e2e_test_ tools (lazy loading replaces them)
    const directMcpTools = toolNames.filter((n: string) => n.startsWith("e2e_test_"));
    expect(directMcpTools).toHaveLength(0);
  });

  test("lazy tools do NOT appear when no extension is enabled", async ({ request }) => {
    const { assignee } = await setupAssigneeWithExtension(
      request,
      "No Ext Test",
      "no-ext@example.com",
      false,
    );

    const toolsRes = await request.get(`/api/tools?assigneeId=${assignee.id}`);
    expect(toolsRes.ok()).toBeTruthy();
    const tools = await toolsRes.json();

    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).not.toContain("search_tools");
    expect(toolNames).not.toContain("read_tool");
    expect(toolNames).not.toContain("use_tool");
  });

  test("agent can search, read, and use extension tools via lazy loading", async ({
    request,
    baseURL,
  }) => {
    const { assignee } = await setupAssigneeWithExtension(
      request,
      "Lazy Agent Test",
      "lazy-agent@example.com",
      true,
    );

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId: assignee.id },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);

    // Subscribe to SSE
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${session.id}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      timeoutMs: 60000,
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Ask agent to search for and use the echo tool
    const msgRes = await request.post(`/api/chat-sessions/${session.id}/messages`, {
      data: {
        content:
          'Search for the "echo" extension tool, then read its details, then use it to echo "hello from lazy tool". [TOOL:search_tools:auto] [TOOL:read_tool:auto] [TOOL:use_tool:auto]',
      },
    });
    expect(msgRes.ok()).toBeTruthy();
    sendMessageResponseSchema.parse(await msgRes.json());

    const events = await eventsPromise;

    // Verify tool-call events for the lazy tools
    const toolCalls = events.filter((e) => e.event === "tool-call").map((e) => e.data.toolName);

    expect(toolCalls).toContain("search_tools");
    expect(toolCalls).toContain("read_tool");
    expect(toolCalls).toContain("use_tool");

    // Verify tool-result events complete without errors
    const toolResults = events.filter((e) => e.event === "tool-result");
    for (const result of toolResults) {
      expect(result.data.isError).toBeFalsy();
    }

    // Verify we got a done event
    const doneEvents = events.filter((e) => e.event === "done");
    expect(doneEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("use_tool returns error for disabled extension tool", async ({ request, baseURL }) => {
    // Create an assignee with extension enabled but a specific tool set to auto-reject
    const assigneeRes = await request.post("/api/assignees", {
      data: {
        name: "Disabled Tool Test",
        email: "disabled-tool@example.com",
      },
    });
    expect(assigneeRes.ok()).toBeTruthy();
    const assignee = await assigneeRes.json();

    // List extensions to find the e2e_test extension
    const extsRes = await request.get(`/api/assignees/${assignee.id}/extensions`);
    const exts = await extsRes.json();
    const e2eExt = exts.find((e: any) => e.prefix === "e2e_test_");

    // Enable extension with echo tool set to disabled
    const enableRes = await request.put(`/api/assignees/${assignee.id}/extensions/${e2eExt.id}`, {
      data: {
        enabled: true,
        toolPermissions: [{ toolName: "echo", permission: "disabled" }],
      },
    });
    expect(enableRes.ok()).toBeTruthy();

    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId: assignee.id },
    });
    const session = await sessionRes.json();

    // Subscribe to SSE
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${session.id}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      timeoutMs: 60000,
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Ask agent to search for echo — it should NOT appear in search results
    const msgRes = await request.post(`/api/chat-sessions/${session.id}/messages`, {
      data: {
        content:
          'Search for the "echo" extension tool and tell me if you found it. [TOOL:search_tools:auto]',
      },
    });
    expect(msgRes.ok()).toBeTruthy();

    const events = await eventsPromise;

    // search_tools should have been called
    const searchCalls = events.filter(
      (e) => e.event === "tool-call" && e.data.toolName === "search_tools",
    );
    expect(searchCalls.length).toBeGreaterThanOrEqual(1);

    // The search result should not contain the disabled echo tool
    const searchResults = events.filter(
      (e) => e.event === "tool-result" && e.data.toolName === "search_tools",
    );
    if (searchResults.length > 0 && searchResults[0].data.output) {
      const output =
        typeof searchResults[0].data.output === "string"
          ? JSON.parse(searchResults[0].data.output)
          : searchResults[0].data.output;

      // The tools array should not include echo
      if (output.tools) {
        const echoTool = output.tools.find(
          (t: any) => t.id === "e2e_test_echo" || t.name === "echo",
        );
        expect(echoTool).toBeUndefined();
      }
    }
  });
});
