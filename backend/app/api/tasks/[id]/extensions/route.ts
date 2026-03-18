import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extensions, taskExtensions, tasks } from "@/lib/db/schema";
import { eq, or, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson } from "@/lib/utils/response";
import { ensureSystemExtensions } from "@/lib/db/seed-extensions";

let systemExtensionsSeeded = false;
async function ensureSeeded() {
  if (!systemExtensionsSeeded) {
    await ensureSystemExtensions();
    systemExtensionsSeeded = true;
  }
}

/**
 * @openapi
 * @operationId listTaskExtensions
 * @response z.array(extensionWithStatusSchema)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id: taskId } = await params;

  // Verify task belongs to user
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, auth.userId)));

  if (!task) {
    return errorJson("Task not found", 404);
  }

  await ensureSeeded();

  const allExtensions = await db
    .select()
    .from(extensions)
    .where(or(eq(extensions.type, "system"), eq(extensions.userId, auth.userId)));

  const teRows = await db.select().from(taskExtensions).where(eq(taskExtensions.taskId, taskId));

  const teMap = new Map(teRows.map((te) => [te.extensionId, te]));

  const result = allExtensions.map((ext) => {
    const te = teMap.get(ext.id);
    return {
      ...ext,
      enabled: te?.enabled ?? false,
      toolPermissions: te?.toolPermissions ?? null,
    };
  });

  return NextResponse.json(result);
}
