import { db } from "@/lib/db";
import { assignees, assigneeExtensions, taskExtensions } from "@/lib/db/schema";
import type { ToolPermission } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Copy the assignee's tool permissions and extension settings to a newly created task.
 * This is called during task creation (both via API and AI tool).
 */
export async function inheritAssigneeToolset(
  taskId: string,
  assigneeId: string,
  userId: string,
): Promise<ToolPermission[] | null> {
  // 1. Copy tool permissions from assignee (scoped by userId for cross-user safety)
  const [assignee] = await db
    .select({ toolPermissions: assignees.toolPermissions })
    .from(assignees)
    .where(and(eq(assignees.id, assigneeId), eq(assignees.userId, userId)));

  if (!assignee) return null;

  const toolPermissions = assignee.toolPermissions ?? null;

  // 2. Copy extension settings from assignee (best-effort, don't fail task creation)
  try {
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
  } catch (error) {
    console.error("[inheritAssigneeToolset] Failed to copy extensions:", error);
  }

  return toolPermissions;
}
