import { sendEmailTool, SEND_EMAIL_TOOL_NAME } from "./send-email";
import { searchEmailsTool, SEARCH_EMAILS_TOOL_NAME } from "./search-emails";
import { createTaskTool, CREATE_TASK_TOOL_NAME } from "./create-task";
import { updateTaskTool, UPDATE_TASK_TOOL_NAME } from "./update-task";
import type { ToolPermission } from "@/lib/db/schema";
import { loadAssigneePermissions, resolvePermission } from "./permission";

export interface ToolSetResult {
  /** Tools filtered to exclude auto-reject entries, ready for streamText */
  tools: Record<
    string,
    | typeof sendEmailTool
    | ReturnType<typeof searchEmailsTool>
    | ReturnType<typeof createTaskTool>
    | ReturnType<typeof updateTaskTool>
  >;
  /** Check permission for a tool name using permissions loaded at build time. Synchronous. */
  checkPermission: (toolName: string) => ToolPermission["permission"];
}

/**
 * Build the tool set for the agent, filtering out auto-rejected tools.
 * Loads permissions from the database using assigneeId.
 */
export async function buildToolSet(
  userId: string,
  assigneeId: string | null,
): Promise<ToolSetResult> {
  const toolPermissions = assigneeId ? await loadAssigneePermissions(assigneeId) : null;

  const allTools = {
    [SEND_EMAIL_TOOL_NAME]: sendEmailTool,
    [SEARCH_EMAILS_TOOL_NAME]: searchEmailsTool(userId),
    [CREATE_TASK_TOOL_NAME]: createTaskTool(userId),
    [UPDATE_TASK_TOOL_NAME]: updateTaskTool(userId),
  };

  const filtered: Record<string, (typeof allTools)[keyof typeof allTools]> = {};
  for (const [name, tool] of Object.entries(allTools)) {
    if (resolvePermission(name, toolPermissions) !== "auto-reject") {
      filtered[name] = tool;
    }
  }

  return {
    tools: filtered,
    checkPermission: (toolName: string) => resolvePermission(toolName, toolPermissions),
  };
}

export {
  SEND_EMAIL_TOOL_NAME,
  SEARCH_EMAILS_TOOL_NAME,
  CREATE_TASK_TOOL_NAME,
  UPDATE_TASK_TOOL_NAME,
};
