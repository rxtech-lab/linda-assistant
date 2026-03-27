import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson } from "@/lib/utils/response";
import { buildToolSet, extractMetadata, NO_PERMISSION_CHANGE_TOOLS } from "@/lib/ai/tools";

/**
 * @openapi
 * @operationId listTaskTools
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id: taskId } = await params;

  const [task] = await db
    .select({ id: tasks.id, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, auth.userId)));

  if (!task) {
    return errorJson("Task not found", 404);
  }

  const result = await buildToolSet(
    auth.userId,
    task.assigneeId,
    auth.accessToken,
    undefined,
    true,
    taskId,
  );

  const metadata = extractMetadata(result);

  const toolsList = metadata.map((tool) => ({
    name: tool.name,
    description: tool.description,
    defaultPermission: tool.needsApproval ? ("manual-confirm" as const) : ("auto-confirm" as const),
    parameters: tool.parameters,
    disablePermissionChange: NO_PERMISSION_CHANGE_TOOLS.has(tool.name) || undefined,
  }));

  return NextResponse.json(toolsList);
}
