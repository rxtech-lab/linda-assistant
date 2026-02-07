import { sendEmailTool, SEND_EMAIL_TOOL_NAME } from "./send-email";
import { searchEmailsTool, SEARCH_EMAILS_TOOL_NAME } from "./search-emails";
import { createTaskTool, CREATE_TASK_TOOL_NAME } from "./create-task";
import { updateTaskTool, UPDATE_TASK_TOOL_NAME } from "./update-task";

export const TOOLS_REQUIRING_CONFIRMATION = new Set([SEND_EMAIL_TOOL_NAME]);

export function buildToolSet(userId: string, availableTools?: string[] | null) {
  const allTools = {
    [SEND_EMAIL_TOOL_NAME]: sendEmailTool,
    [SEARCH_EMAILS_TOOL_NAME]: searchEmailsTool(userId),
    [CREATE_TASK_TOOL_NAME]: createTaskTool(userId),
    [UPDATE_TASK_TOOL_NAME]: updateTaskTool(userId),
  };

  if (!availableTools || availableTools.length === 0) {
    return allTools;
  }

  const filtered: Record<string, (typeof allTools)[keyof typeof allTools]> = {};
  for (const name of availableTools) {
    if (name in allTools) {
      filtered[name] = allTools[name as keyof typeof allTools];
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
