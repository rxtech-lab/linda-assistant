import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extensions, taskExtensions, tasks } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { taskExtensionSettingsSchema, extensionWithStatusSchema } from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId updateTaskExtension
 * @body taskExtensionSettingsSchema
 * @response extensionWithStatusSchema
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; extensionId: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id: taskId, extensionId } = await params;

  // Verify task belongs to user
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, auth.userId)));

  if (!task) {
    return errorJson("Task not found", 404);
  }

  // Verify extension exists and is accessible
  const [ext] = await db
    .select()
    .from(extensions)
    .where(
      and(
        eq(extensions.id, extensionId),
        or(eq(extensions.type, "system"), eq(extensions.userId, auth.userId)),
      ),
    );

  if (!ext) {
    return errorJson("Extension not found", 404);
  }

  const body = await request.json();
  const parsed = taskExtensionSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0].message);
  }

  const { enabled, toolPermissions } = parsed.data;

  // Upsert task_extensions row (mirrors assignee extension pattern)
  const existing = await db
    .select()
    .from(taskExtensions)
    .where(and(eq(taskExtensions.taskId, taskId), eq(taskExtensions.extensionId, extensionId)));

  if (existing.length > 0) {
    await db
      .update(taskExtensions)
      .set({
        enabled,
        ...(toolPermissions !== undefined && { toolPermissions }),
        updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      })
      .where(eq(taskExtensions.id, existing[0].id));
  } else {
    await db.insert(taskExtensions).values({
      taskId,
      extensionId,
      enabled,
      toolPermissions: toolPermissions ?? null,
    });
  }

  return NextResponse.json({
    ...ext,
    enabled,
    toolPermissions: toolPermissions ?? existing[0]?.toolPermissions ?? null,
  });
}
