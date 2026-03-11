import { db } from "@/lib/db";
import { assignees } from "@/lib/db/schema";
import type { ToolPermission } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Resolve permission level for a tool from an in-memory permissions array.
 * Defaults to "manual-confirm" when no permissions are configured.
 */
export function resolvePermission(
  toolName: string,
  toolPermissions?: ToolPermission[] | null,
): ToolPermission["permission"] {
  if (!toolPermissions || toolPermissions.length === 0) {
    return "manual-confirm";
  }
  const entry = toolPermissions.find((tp) => tp.toolName === toolName);
  return entry?.permission ?? "manual-confirm";
}

/**
 * Load tool permissions for an assignee from the database.
 */
export async function loadAssigneePermissions(
  assigneeId: string,
): Promise<ToolPermission[] | null> {
  const [row] = await db
    .select({ toolPermissions: assignees.toolPermissions })
    .from(assignees)
    .where(eq(assignees.id, assigneeId));
  return row?.toolPermissions ?? null;
}

/**
 * Check permission for a specific tool by querying the assignee from DB.
 */
export async function checkPermission(
  assigneeId: string | null,
  toolName: string,
): Promise<ToolPermission["permission"]> {
  if (!assigneeId) return "manual-confirm";
  const permissions = await loadAssigneePermissions(assigneeId);
  return resolvePermission(toolName, permissions);
}

/** Discriminated union result from runToolWithPermissionCheck */
export type PermissionCheckResult =
  | { status: "executed"; result: unknown }
  | { status: "confirmation_required" }
  | { status: "rejected" };

/**
 * Check permission for a tool and conditionally execute it.
 * - auto-confirm: executes immediately, returns { status: "executed", result }
 * - manual-confirm: returns { status: "confirmation_required" }
 * - auto-reject: returns { status: "rejected" }
 * - disabled: returns { status: "rejected" } (tool should not be in toolset)
 */
export async function runToolWithPermissionCheck(
  assigneeId: string | null,
  toolName: string,
  executeTool: () => Promise<unknown>,
): Promise<PermissionCheckResult> {
  const permission = await checkPermission(assigneeId, toolName);

  switch (permission) {
    case "auto-confirm": {
      const result = await executeTool();
      return { status: "executed", result };
    }
    case "manual-confirm":
      return { status: "confirmation_required" };
    case "auto-reject":
    case "disabled":
      return { status: "rejected" };
  }
}
