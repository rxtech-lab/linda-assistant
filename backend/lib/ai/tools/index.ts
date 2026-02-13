import { db } from "@/lib/db";
import type { ToolPermission } from "@/lib/db/schema";
import { assignees } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createInvoiceMcp } from "./mcps/invoice";
import { CREATE_TASK_TOOL_NAME, createTaskTool } from "./create-task";
import { loadAssigneePermissions, resolvePermission } from "./permission";
import { SEARCH_EMAILS_TOOL_NAME, searchEmailsTool } from "./search-emails";
import { SEND_EMAIL_TOOL_NAME, sendEmailTool } from "./send-email";
import { UPDATE_TASK_TOOL_NAME, updateTaskTool } from "./update-task";
import { createFilesMcp } from "./mcps/files";

export interface ToolSetResult {
  /** Tools filtered to exclude auto-reject entries, built with correct needsApproval */
  tools: Record<string, unknown>;
}

/**
 * Generic MCP configuration for loading external tools
 */
interface McpConfig {
  /** Prefix to add to all tool names from this MCP */
  prefix: string;
  /** Function to create the MCP client */
  createMcp: (
    accessToken: string,
    needsApproval: Record<string, boolean>,
  ) => Promise<Record<string, unknown>>;
}

/**
 * Load tools from a generic MCP server with permission filtering
 */
async function loadMcpTools(
  config: McpConfig,
  accessToken: string,
  toolPermissions: ToolPermission[] | null,
): Promise<Record<string, unknown>> {
  if (!accessToken) {
    return {};
  }

  try {
    // First fetch tools to discover their names
    const rawTools = await config.createMcp(accessToken, {});
    const needsApproval: Record<string, boolean> = {};

    // Build needsApproval map based on permissions
    for (const toolName of Object.keys(rawTools)) {
      const perm = resolvePermission(toolName, toolPermissions);
      if (perm === "auto-reject") continue;
      needsApproval[toolName] = perm === "manual-confirm";
    }

    // Fetch tools again with correct needsApproval settings
    const mcpTools = await config.createMcp(accessToken, needsApproval);

    // Prefix tool names and filter out auto-rejected tools
    const prefixed: Record<string, unknown> = {};
    for (const [toolName, tool] of Object.entries(mcpTools)) {
      const perm = resolvePermission(toolName, toolPermissions);
      if (perm === "auto-reject") continue;
      prefixed[`${config.prefix}${toolName}`] = tool as unknown;
    }

    return prefixed;
  } catch (error) {
    console.warn(
      `[loadMcpTools] Failed to load ${config.prefix} MCP tools:`,
      error,
    );
    return {};
  }
}

/**
 * Build the tool set for the agent with permission-aware needsApproval.
 *
 * Each tool is built with `needsApproval` derived from the assignee's permission:
 * - auto-confirm → needsApproval: false → SDK executes immediately
 * - manual-confirm → needsApproval: true → SDK emits tool-approval-request
 * - auto-reject → tool excluded from toolset
 */
export async function buildToolSet(
  userId: string,
  assigneeId: string | null,
  accessToken: string,
): Promise<ToolSetResult> {
  const toolPermissions = assigneeId
    ? await loadAssigneePermissions(assigneeId)
    : null;

  // Load assignee email for send_email from address
  let fromAddress = `linda@${process.env.RESEND_DOMAIN || "assistant.rxlab.app"}`;
  if (assigneeId) {
    const [a] = await db
      .select({ email: assignees.email })
      .from(assignees)
      .where(eq(assignees.id, assigneeId));
    if (a?.email) fromAddress = a.email;
  }

  // Static tool definitions
  const toolDefs = [
    {
      name: SEND_EMAIL_TOOL_NAME,
      create: (na: boolean) => sendEmailTool(fromAddress, na),
    },
    {
      name: SEARCH_EMAILS_TOOL_NAME,
      create: (na: boolean) => searchEmailsTool(userId, na),
    },
    {
      name: CREATE_TASK_TOOL_NAME,
      create: (na: boolean) => createTaskTool(userId, na),
    },
    {
      name: UPDATE_TASK_TOOL_NAME,
      create: (na: boolean) => updateTaskTool(userId, na),
    },
  ];

  // Build static tools
  const filtered: Record<string, unknown> = {};
  for (const { name, create } of toolDefs) {
    const perm = resolvePermission(name, toolPermissions);
    if (perm === "auto-reject") continue;
    filtered[name] = create(perm === "manual-confirm");
  }

  // Skip MCP tools in E2E test mode (no valid OAuth tokens for external services)
  if (!process.env.IS_E2E) {
    // MCP server configurations - add more MCPs here
    const mcpConfigs: McpConfig[] = [
      {
        prefix: "invoice_",
        createMcp: createInvoiceMcp,
      },
      // Add more MCP configurations here in the future:
      {
        prefix: "files_",
        createMcp: createFilesMcp,
      },
    ];

    // Load all MCP tools in parallel
    const mcpResults = await Promise.allSettled(
      mcpConfigs.map((mcpConfig) =>
        loadMcpTools(mcpConfig, accessToken, toolPermissions),
      ),
    );

    for (const result of mcpResults) {
      if (result.status === "fulfilled") {
        Object.assign(filtered, result.value);
      }
    }
  }

  return { tools: filtered };
}

export {
  CREATE_TASK_TOOL_NAME,
  SEARCH_EMAILS_TOOL_NAME,
  SEND_EMAIL_TOOL_NAME,
  UPDATE_TASK_TOOL_NAME,
};
