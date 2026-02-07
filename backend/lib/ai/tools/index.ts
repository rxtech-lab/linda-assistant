import { sendEmailTool, SEND_EMAIL_TOOL_NAME } from "./send-email";
import { searchEmailsTool, SEARCH_EMAILS_TOOL_NAME } from "./search-emails";
import { createTaskTool, CREATE_TASK_TOOL_NAME } from "./create-task";
import { updateTaskTool, UPDATE_TASK_TOOL_NAME } from "./update-task";
import type { ToolPermission } from "@/lib/db/schema";

export function getToolPermission(
  toolName: string,
  toolPermissions?: ToolPermission[] | null
): ToolPermission["permission"] {
  if (!toolPermissions || toolPermissions.length === 0) {
    return "manual-confirm";
  }
  const entry = toolPermissions.find((tp) => tp.toolName === toolName);
  return entry?.permission ?? "manual-confirm";
}

export function buildToolSet(
  userId: string,
  toolPermissions?: ToolPermission[] | null
) {
  const allTools = {
    [SEND_EMAIL_TOOL_NAME]: sendEmailTool,
    [SEARCH_EMAILS_TOOL_NAME]: searchEmailsTool(userId),
    [CREATE_TASK_TOOL_NAME]: createTaskTool(userId),
    [UPDATE_TASK_TOOL_NAME]: updateTaskTool(userId),
  };

  if (!toolPermissions || toolPermissions.length === 0) {
    return allTools;
  }

  // Filter out tools with auto-reject permission
  const filtered: Record<string, (typeof allTools)[keyof typeof allTools]> = {};
  for (const [name, tool] of Object.entries(allTools)) {
    const permission = getToolPermission(name, toolPermissions);
    if (permission !== "auto-reject") {
      filtered[name] = tool;
    }
  }
  return filtered;
}

export {
  SEND_EMAIL_TOOL_NAME,
  SEARCH_EMAILS_TOOL_NAME,
  CREATE_TASK_TOOL_NAME,
  UPDATE_TASK_TOOL_NAME,
};
