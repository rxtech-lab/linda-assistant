import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks, chatSessions } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson, successJson } from "@/lib/utils/response";
import { createAssigneeFollowUp } from "@/lib/utils/chat-session";
import { z } from "zod";

const executeNowResponseSchema = z.object({
  sessionId: z.string().describe("Created chat session ID"),
  queued: z.boolean().describe("Whether the agent task was queued"),
});

/**
 * @openapi
 * @operationId executeTaskNow
 * @pathParams idParamSchema
 * @response executeNowResponseSchema
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)));

  if (!task) return errorJson("Task not found", 404);
  if (!task.assigneeId) return errorJson("Task has no assignee configured", 422);
  if (task.status === "stopped") return errorJson("Task is stopped", 422);

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
    auth.accessToken,
  );

  return successJson({ sessionId: session.id, queued: true });
}
