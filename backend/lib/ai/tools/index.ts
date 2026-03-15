import { db } from "@/lib/db";
import type { ToolPermission } from "@/lib/db/schema";
import { assignees } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createInvoiceMcp } from "./mcps/invoice";
import { CREATE_TASK_TOOL_NAME, createTaskTool } from "./create-task";
import { CREATE_DOCUMENT_TOOL_NAME, createDocumentTool } from "./create-document";
import { getActiveSessionMessages } from "@/lib/db/messages";
import { loadAssigneePermissions, resolvePermission } from "./permission";
import { SEARCH_EMAILS_TOOL_NAME, searchEmailsTool } from "./search-emails";
import { SEND_EMAIL_TOOL_NAME, sendEmailTool } from "./send-email";
import { UPDATE_TASK_TOOL_NAME, updateTaskTool } from "./update-task";
import { GET_CURRENT_TIME_TOOL_NAME, getCurrentTimeTool } from "./get-current-time";
import { ASK_QUESTION_TOOL_NAME, askQuestionTool } from "./ask-question";
import { GET_LOCATION_TOOL_NAME, getLocationTool } from "./get-location";
import { UPDATE_DOCUMENT_TOOL_NAME, updateDocumentTool } from "./update-document";
import { createFilesMcp } from "./mcps/files";
import { createFirecrawlMcp } from "./mcps/firecrawl";
import { createTransportMcp } from "./mcps/transport";

export interface ToolSetResult {
  /** Tools filtered to exclude auto-reject and disabled entries, built with correct needsApproval */
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
      const perm = resolvePermission(`${config.prefix}${toolName}`, toolPermissions);
      if (perm === "auto-reject" || perm === "disabled") continue;
      needsApproval[toolName] = perm === "manual-confirm";
    }

    // Fetch tools again with correct needsApproval settings
    const mcpTools = await config.createMcp(accessToken, needsApproval);

    // Prefix tool names and filter out auto-rejected tools
    const prefixed: Record<string, unknown> = {};
    for (const [toolName, tool] of Object.entries(mcpTools)) {
      const perm = resolvePermission(`${config.prefix}${toolName}`, toolPermissions);
      if (perm === "auto-reject" || perm === "disabled") continue;
      prefixed[`${config.prefix}${toolName}`] = tool as unknown;
    }

    return prefixed;
  } catch (error) {
    console.warn(`[loadMcpTools] Failed to load ${config.prefix} MCP tools:`, error);
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
 * - disabled → tool excluded from toolset
 */
export async function buildToolSet(
  userId: string,
  assigneeId: string | null,
  accessToken: string,
  chatSessionId?: string,
): Promise<ToolSetResult> {
  const isE2E = process.env.IS_E2E?.toLowerCase() === "true";
  const toolPermissions = assigneeId ? await loadAssigneePermissions(assigneeId) : null;

  // In E2E mode, parse [TOOL:name:auto] patterns from the latest user message
  // to dynamically override specific tools' needsApproval to false
  const autoConfirmOverrides = new Set<string>();
  if (isE2E && chatSessionId) {
    const messages = await getActiveSessionMessages(chatSessionId);
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    if (lastUserMsg && Array.isArray((lastUserMsg as any).content)) {
      const text = ((lastUserMsg as any).content as any[])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(" ");
      // Match [TOOL:name:auto] and [TOOL:parallel:auto]
      for (const match of text.matchAll(/\[TOOL:(\w+):auto\]/g)) {
        autoConfirmOverrides.add(match[1]);
      }
      // [TOOL:parallel:auto] overrides both send_email and create_task
      if (autoConfirmOverrides.has("parallel")) {
        autoConfirmOverrides.add("send_email");
        autoConfirmOverrides.add("create_task");
      }
    }
  }

  // Load assignee email for send_email from address
  let fromAddress = `linda@${process.env.RESEND_DOMAIN || "assistant.rxlab.app"}`;
  if (assigneeId) {
    const [a] = await db
      .select({ email: assignees.email })
      .from(assignees)
      .where(eq(assignees.id, assigneeId));
    if (a?.email) fromAddress = a.email;
  }

  // Static tool definitions (permission-aware)
  const toolDefs: Array<{ name: string; create: (na: boolean) => unknown }> = [
    {
      name: SEND_EMAIL_TOOL_NAME,
      create: (na: boolean) => sendEmailTool(fromAddress, userId, na),
    },
    {
      name: SEARCH_EMAILS_TOOL_NAME,
      create: (na: boolean) => searchEmailsTool(userId, na),
    },
    {
      name: CREATE_TASK_TOOL_NAME,
      create: (na: boolean) => createTaskTool(userId, na, chatSessionId),
    },
    {
      name: UPDATE_TASK_TOOL_NAME,
      create: (na: boolean) => updateTaskTool(userId, na, chatSessionId),
    },
    {
      name: GET_CURRENT_TIME_TOOL_NAME,
      create: (na: boolean) => getCurrentTimeTool(na),
    },
    {
      name: ASK_QUESTION_TOOL_NAME,
      create: (_na: boolean) => askQuestionTool(),
    },
    {
      name: GET_LOCATION_TOOL_NAME,
      create: (_na: boolean) => getLocationTool(),
    },
  ];

  // Build permission-aware tools
  const filtered: Record<string, unknown> = {};
  for (const { name, create } of toolDefs) {
    const perm = resolvePermission(name, toolPermissions);
    if (perm === "auto-reject" || perm === "disabled") continue;
    const needsApproval = autoConfirmOverrides.has(name) ? false : perm === "manual-confirm";
    filtered[name] = create(needsApproval);
  }

  // Document tools — never require confirmation
  filtered[UPDATE_DOCUMENT_TOOL_NAME] = updateDocumentTool(userId);
  if (chatSessionId) {
    filtered[CREATE_DOCUMENT_TOOL_NAME] = createDocumentTool(userId, chatSessionId);
  }

  // Skip MCP tools in E2E test mode (no valid OAuth tokens for external services)
  if (!isE2E) {
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
      {
        prefix: "firecrawl_",
        createMcp: createFirecrawlMcp,
      },
      {
        prefix: "transport_",
        createMcp: createTransportMcp,
      },
    ];

    // Load all MCP tools in parallel
    const mcpResults = await Promise.allSettled(
      mcpConfigs.map((mcpConfig) => loadMcpTools(mcpConfig, accessToken, toolPermissions)),
    );

    for (let i = 0; i < mcpResults.length; i++) {
      const result = mcpResults[i];
      if (result.status === "fulfilled") {
        Object.assign(filtered, result.value);
      } else {
        console.error(`[buildToolSet] MCP ${mcpConfigs[i].prefix} failed to load:`, result.reason);
      }
    }
  }

  return { tools: filtered };
}

export {
  ASK_QUESTION_TOOL_NAME,
  CREATE_DOCUMENT_TOOL_NAME,
  CREATE_TASK_TOOL_NAME,
  GET_CURRENT_TIME_TOOL_NAME,
  GET_LOCATION_TOOL_NAME,
  SEARCH_EMAILS_TOOL_NAME,
  SEND_EMAIL_TOOL_NAME,
  UPDATE_DOCUMENT_TOOL_NAME,
  UPDATE_TASK_TOOL_NAME,
};
