import { sendEmailTool, SEND_EMAIL_TOOL_NAME } from "./send-email";
import { searchEmailsTool, SEARCH_EMAILS_TOOL_NAME } from "./search-emails";
import { createTaskTool, CREATE_TASK_TOOL_NAME } from "./create-task";
import { updateTaskTool, UPDATE_TASK_TOOL_NAME } from "./update-task";
import { loadAssigneePermissions, resolvePermission } from "./permission";
import { db } from "@/lib/db";
import { assignees } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface ToolSetResult {
  /** Tools filtered to exclude auto-reject entries, built with correct needsApproval */
  tools: Record<
    string,
    | ReturnType<typeof sendEmailTool>
    | ReturnType<typeof searchEmailsTool>
    | ReturnType<typeof createTaskTool>
    | ReturnType<typeof updateTaskTool>
  >;
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
): Promise<ToolSetResult> {
  const toolPermissions = assigneeId ? await loadAssigneePermissions(assigneeId) : null;

  // Load assignee email for send_email from address
  let fromAddress = `linda@${process.env.RESEND_DOMAIN || "assistant.rxlab.io"}`;
  if (assigneeId) {
    const [a] = await db
      .select({ email: assignees.email })
      .from(assignees)
      .where(eq(assignees.id, assigneeId));
    if (a?.email) fromAddress = a.email;
  }

  const toolDefs = [
    { name: SEND_EMAIL_TOOL_NAME, create: (na: boolean) => sendEmailTool(fromAddress, na) },
    { name: SEARCH_EMAILS_TOOL_NAME, create: (na: boolean) => searchEmailsTool(userId, na) },
    { name: CREATE_TASK_TOOL_NAME, create: (na: boolean) => createTaskTool(userId, na) },
    { name: UPDATE_TASK_TOOL_NAME, create: (na: boolean) => updateTaskTool(userId, na) },
  ];

  const filtered: Record<string, ReturnType<(typeof toolDefs)[number]["create"]>> = {};
  for (const { name, create } of toolDefs) {
    const perm = resolvePermission(name, toolPermissions);
    if (perm === "auto-reject") continue;
    filtered[name] = create(perm === "manual-confirm");
  }

  return { tools: filtered };
}

export {
  SEND_EMAIL_TOOL_NAME,
  SEARCH_EMAILS_TOOL_NAME,
  CREATE_TASK_TOOL_NAME,
  UPDATE_TASK_TOOL_NAME,
};
