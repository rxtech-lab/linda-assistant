import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks, chatSessions } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { errorJson, successJson } from "@/lib/utils/response";
import { createAssigneeFollowUp } from "@/lib/utils/chat-session";
import { z } from "zod";

const executeResponseSchema = z.object({
  sessionId: z.string().describe("Created chat session ID"),
  queued: z.boolean().describe("Whether the agent task was queued"),
});

/**
 * @openapi
 * @operationId executeTask
 * @pathParams idParamSchema
 * @response executeResponseSchema
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authHeader = request.headers.get("authorization");
  const adminKey = process.env.CELERY_ADMIN_KEY;

  if (!adminKey || authHeader !== `Bearer ${adminKey}`) {
    return errorJson("Unauthorized", 401);
  }

  const { id } = await params;

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));

  if (!task) return errorJson("Task not found", 404);
  if (!task.assigneeId) return errorJson("Task has no assignee configured", 422);

  const activeSessions = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.taskId, id),
        inArray(chatSessions.status, ["starting", "in_progress", "waiting_confirmation"]),
      ),
    );

  if (activeSessions.length > 0) {
    return errorJson("Task already has an active run in progress", 409);
  }

  const session = await createAssigneeFollowUp(
    task.description ?? task.title,
    { userId: task.userId, id: task.assigneeId },
    task.title,
    task.id,
  );

  return successJson({ sessionId: session.id, queued: true });
}
