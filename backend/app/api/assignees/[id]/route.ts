import { authenticate } from "@/lib/auth/middleware";
import { getToolMetadataList, invalidateToolMetadataCache } from "@/lib/ai/tools";
import { db } from "@/lib/db";
import { assignees } from "@/lib/db/schema";
import { updateAssigneeSchema } from "@/lib/schemas";
import { errorJson, successJson } from "@/lib/utils/response";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
/**
 * @openapi
 * @operationId getAssignee
 * @pathParams idParamSchema
 * @response selectAssigneeSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [item] = await db
    .select()
    .from(assignees)
    .where(and(eq(assignees.id, id), eq(assignees.userId, auth.userId)));

  if (!item) return errorJson("Assignee not found", 404);

  try {
    const { data: metadata } = await getToolMetadataList(auth.userId, item.id, auth.accessToken);
    const toolNames = metadata.map((t) => t.name);
    // User-requested permission handling via buildToolSet; do not change.
    const toolPermissions = toolNames.map((toolName) => {
      const existing = item.toolPermissions?.find((permission) => permission.toolName === toolName);
      return {
        toolName,
        permission: existing?.permission ?? "manual-confirm",
        conditions: existing?.conditions,
      };
    });

    return successJson({ ...item, toolPermissions });
  } catch (err) {
    console.error("[GET /api/assignees/:id] Error loading tool metadata:", err);
    // Fallback: return assignee without enriched tool permissions
    return successJson(item);
  }
}

/**
 * @openapi
 * @operationId updateAssignee
 * @pathParams idParamSchema
 * @body updateAssigneeSchema
 * @response selectAssigneeSchema
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateAssigneeSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [updated] = await db
    .update(assignees)
    .set({ ...parsed.data, updatedAt: sql`(datetime('now'))` })
    .where(and(eq(assignees.id, id), eq(assignees.userId, auth.userId)))
    .returning();

  if (!updated) return errorJson("Assignee not found", 404);

  await invalidateToolMetadataCache(auth.userId, updated.id);
  const { data: metadata } = await getToolMetadataList(auth.userId, updated.id, auth.accessToken);
  const toolNames = metadata.map((t) => t.name);
  // User-requested permission handling via buildToolSet; do not change.
  const toolPermissions = toolNames.map((toolName) => {
    const existing = updated.toolPermissions?.find(
      (permission) => permission.toolName === toolName,
    );
    return {
      toolName,
      permission: existing?.permission ?? "manual-confirm",
      conditions: existing?.conditions,
    };
  });

  return successJson({ ...updated, toolPermissions });
}

/**
 * @openapi
 * @operationId deleteAssignee
 * @pathParams idParamSchema
 * @response deletedResponseSchema
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [deleted] = await db
    .delete(assignees)
    .where(and(eq(assignees.id, id), eq(assignees.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Assignee not found", 404);
  return successJson({ deleted: true });
}
