import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks, chatSessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson, successJson } from "@/lib/utils/response";
import { z } from "zod";

const sessionSummarySchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      status: z.string().nullable(),
      assigneeId: z.string().nullable(),
      createdAt: z.string().nullable(),
      updatedAt: z.string().nullable(),
    })
  ),
});

/**
 * @openapi
 * @response 200 - sessionSummarySchema
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  // Verify task belongs to user
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)));

  if (!task) return errorJson("Task not found", 404);

  const sessions = await db
    .select({
      id: chatSessions.id,
      title: chatSessions.title,
      status: chatSessions.status,
      assigneeId: chatSessions.assigneeId,
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
    })
    .from(chatSessions)
    .where(eq(chatSessions.taskId, id));

  return successJson(sessions);
}

