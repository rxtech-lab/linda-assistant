import { db } from "@/lib/db";
import { assignees, assigneeExtensions, taskExtensions } from "@/lib/db/schema";
import type { ToolPermission } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Copy the assignee's tool permissions and enabled extensions to a newly created task.
 * This is called during task creation (both via API and AI tool).
 */
export async function inheritAssigneeToolset(
  taskId: string,
  assigneeId: string,
): Promise<ToolPermission[] | null> {
  // 1. Copy tool permissions from assignee
  const [assignee] = await db
    .select({ toolPermissions: assignees.toolPermissions })
    .from(assignees)
    .where(eq(assignees.id, assigneeId));

  const toolPermissions = assignee?.toolPermissions ?? null;

  // 2. Copy enabled extensions from assignee
  const aeRows = await db
    .select()
    .from(assigneeExtensions)
    .where(eq(assigneeExtensions.assigneeId, assigneeId));

  if (aeRows.length > 0) {
    const values = aeRows.map((ae) => ({
      taskId,
      extensionId: ae.extensionId,
      enabled: ae.enabled,
      toolPermissions: ae.toolPermissions,
    }));

    await db.insert(taskExtensions).values(values);
  }

  return toolPermissions;
}
