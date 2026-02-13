import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import {
  updateAssigneeSchema,
  selectAssigneeSchema,
  deletedResponseSchema,
  idParamSchema,
} from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
/**
 * @openapi
 * @operationId getAssignee
 * @pathParams idParamSchema
 * @response selectAssigneeSchema
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [item] = await db
    .select()
    .from(assignees)
    .where(and(eq(assignees.id, id), eq(assignees.userId, auth.userId)));

  if (!item) return errorJson("Assignee not found", 404);

  return successJson(item);
}

/**
 * @openapi
 * @operationId updateAssignee
 * @pathParams idParamSchema
 * @body updateAssigneeSchema
 * @response selectAssigneeSchema
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
  return successJson(updated);
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
