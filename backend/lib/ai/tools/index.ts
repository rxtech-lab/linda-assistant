import { db } from "@/lib/db";
import type { ToolPermission } from "@/lib/db/schema";
import { assignees, extensions, assigneeExtensions } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
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
import { SEND_NOTIFICATION_TOOL_NAME, sendNotificationTool } from "./send-notification";
import { SEARCH_DOCUMENTS_TOOL_NAME, searchDocumentsTool } from "./search-documents";
import { CREATE_BRIEFING_TOOL_NAME, createBriefingTool } from "./create-briefing";
import { type AuthConfig, createGenericMcp } from "./mcps/generic";
import { redis } from "@/lib/redis";

export interface ToolSetResult {
  /** Tools filtered to exclude auto-reject and disabled entries, built with correct needsApproval */
  tools: Record<string, unknown>;
}

/**
 * Load tools from an MCP server with permission filtering
 */
async function loadMcpTools(
  prefix: string,
  mcpUrl: string,
  auth: AuthConfig,
  toolPermissions: ToolPermission[] | null,
): Promise<Record<string, unknown>> {
  try {
    // First fetch tools to discover their names
    const rawTools = await createGenericMcp(mcpUrl, auth, {});
    const needsApproval: Record<string, boolean> = {};

    // Build needsApproval map based on permissions
    for (const toolName of Object.keys(rawTools)) {
      const perm = resolvePermission(`${prefix}${toolName}`, toolPermissions);
      if (perm === "auto-reject" || perm === "disabled") continue;
      needsApproval[toolName] = perm === "manual-confirm";
    }

    // Fetch tools again with correct needsApproval settings
    const mcpTools = await createGenericMcp(mcpUrl, auth, needsApproval);

    // Prefix tool names and filter out auto-rejected tools
    const prefixed: Record<string, unknown> = {};
    for (const [toolName, tool] of Object.entries(mcpTools)) {
      const perm = resolvePermission(`${prefix}${toolName}`, toolPermissions);
      if (perm === "auto-reject" || perm === "disabled") continue;
      prefixed[`${prefix}${toolName}`] = tool as unknown;
    }

    return prefixed;
  } catch (error) {
    console.warn(`[loadMcpTools] Failed to load ${prefix} MCP tools:`, error);
    return {};
  }
}

/**
 * Build AuthConfig from extension row + session access token
 */
function buildAuthConfig(
  authType: string,
  authConfigJson: Record<string, unknown> | null,
  accessToken: string,
): AuthConfig {
  switch (authType) {
    case "api_key":
      return { type: "api_key", apiKey: (authConfigJson?.apiKey as string) ?? "" };
    case "none":
      return { type: "none" };
    case "rxauth":
    default:
      return { type: "rxauth", accessToken };
  }
}

/**
 * Get enabled extensions for an assignee, including auth config
 */
async function getEnabledExtensions(
  userId: string,
  assigneeId: string | null,
  accessToken: string,
): Promise<
  Array<{
    prefix: string;
    mcpUrl: string;
    auth: AuthConfig;
    extToolPermissions: ToolPermission[] | null;
  }>
> {
  if (!assigneeId) return [];

  // Get all extensions available to this user (system + user's own)
  const allExtensions = await db
    .select()
    .from(extensions)
    .where(or(eq(extensions.type, "system"), eq(extensions.userId, userId)));

  if (allExtensions.length === 0) return [];

  // Get assignee extension settings
  const aeRows = await db
    .select()
    .from(assigneeExtensions)
    .where(eq(assigneeExtensions.assigneeId, assigneeId));

  const aeMap = new Map(aeRows.map((ae) => [ae.extensionId, ae]));

  const result: Array<{
    prefix: string;
    mcpUrl: string;
    auth: AuthConfig;
    extToolPermissions: ToolPermission[] | null;
  }> = [];

  for (const ext of allExtensions) {
    const ae = aeMap.get(ext.id);
    if (!ae?.enabled) continue; // Skip disabled or not-configured extensions

    result.push({
      prefix: ext.prefix,
      mcpUrl: ext.mcpUrl,
      auth: buildAuthConfig(ext.authType, ext.authConfig, accessToken),
      extToolPermissions: ae.toolPermissions,
    });
  }

  return result;
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
      create: (na: boolean) => createTaskTool(userId, na, chatSessionId, assigneeId),
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

  // Search documents — never require confirmation (read-only)
  filtered[SEARCH_DOCUMENTS_TOOL_NAME] = searchDocumentsTool(userId, false);

  // Briefing tool — never require confirmation
  if (chatSessionId) {
    filtered[CREATE_BRIEFING_TOOL_NAME] = createBriefingTool(userId, chatSessionId, assigneeId);
  }

  // Notification tool — never require confirmation
  filtered[SEND_NOTIFICATION_TOOL_NAME] = sendNotificationTool(userId, chatSessionId);

  // Skip MCP tools in E2E test mode (no valid OAuth tokens for external services)
  if (!isE2E) {
    // Query enabled extensions for this assignee from DB
    const enabledExtensions = await getEnabledExtensions(userId, assigneeId, accessToken);

    // Load all enabled extension MCP tools in parallel
    const mcpResults = await Promise.allSettled(
      enabledExtensions.map(({ prefix, mcpUrl, auth, extToolPermissions }) =>
        loadMcpTools(prefix, mcpUrl, auth, extToolPermissions ?? toolPermissions),
      ),
    );

    for (let i = 0; i < mcpResults.length; i++) {
      const result = mcpResults[i];
      if (result.status === "fulfilled") {
        Object.assign(filtered, result.value);
      } else {
        console.error(
          `[buildToolSet] MCP ${enabledExtensions[i].prefix} failed to load:`,
          result.reason,
        );
      }
    }
  }

  return { tools: filtered };
}

export type ToolMetadata = {
  name: string;
  description: string;
  needsApproval: boolean;
};

export type ToolMetadataResult = { data: ToolMetadata[]; fromCache: boolean };

const TOOL_META_TTL = 600; // 10 minutes

function toolMetaCacheKey(userId: string, assigneeId: string): string {
  return `tool-meta:${userId}:${assigneeId}`;
}

/**
 * Get tool metadata list with Redis caching.
 * Skips cache when assigneeId is null (cheap path, no MCP tools).
 */
export async function getToolMetadataList(
  userId: string,
  assigneeId: string | null,
  accessToken: string,
): Promise<ToolMetadataResult> {
  // No cache for null assigneeId — cheap path without MCP tools
  if (!assigneeId) {
    return {
      data: extractMetadata(await buildToolSet(userId, assigneeId, accessToken)),
      fromCache: false,
    };
  }

  const cacheKey = toolMetaCacheKey(userId, assigneeId);
  const cached = await redis.get<string>(cacheKey);
  if (cached) {
    const data = typeof cached === "string" ? JSON.parse(cached) : cached;
    return { data, fromCache: true };
  }

  const result = await buildToolSet(userId, assigneeId, accessToken);
  const metadata = extractMetadata(result);
  await redis.set(cacheKey, JSON.stringify(metadata), { ex: TOOL_META_TTL });
  return { data: metadata, fromCache: false };
}

function extractMetadata(result: ToolSetResult): ToolMetadata[] {
  return Object.entries(result.tools).map(([name, tool]) => {
    const t = tool as { description?: string; needsApproval?: boolean };
    return {
      name,
      description: t.description ?? "",
      needsApproval: t.needsApproval ?? false,
    };
  });
}

/**
 * Invalidate cached tool metadata for a specific assignee.
 */
export async function invalidateToolMetadataCache(
  userId: string,
  assigneeId: string,
): Promise<void> {
  await redis.del(toolMetaCacheKey(userId, assigneeId));
}

export {
  ASK_QUESTION_TOOL_NAME,
  CREATE_BRIEFING_TOOL_NAME,
  CREATE_DOCUMENT_TOOL_NAME,
  CREATE_TASK_TOOL_NAME,
  GET_CURRENT_TIME_TOOL_NAME,
  GET_LOCATION_TOOL_NAME,
  SEARCH_DOCUMENTS_TOOL_NAME,
  SEARCH_EMAILS_TOOL_NAME,
  SEND_EMAIL_TOOL_NAME,
  SEND_NOTIFICATION_TOOL_NAME,
  UPDATE_DOCUMENT_TOOL_NAME,
  UPDATE_TASK_TOOL_NAME,
};
