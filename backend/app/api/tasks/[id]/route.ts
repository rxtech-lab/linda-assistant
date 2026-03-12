import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks, chatSessions, taskEmails, emailInbox } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import {
  updateTaskSchema,
  selectTaskSchema,
  deletedResponseSchema,
  idParamSchema,
} from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { registerCronTask, updateCronTask, deleteCronTask } from "@/lib/celery/client";
import { getNextRunSeconds } from "@/lib/utils/cron";
import { z } from "zod";

const taskDetailSchema = selectTaskSchema.extend({
  chatSessions: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      status: z.string().nullable(),
      updatedAt: z.string().nullable(),
    }),
  ),
  emails: z.array(z.any()),
});

/**
 * @openapi
 * @operationId getTask
 * @pathParams idParamSchema
 * @response taskDetailSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)));

  if (!task) return errorJson("Task not found", 404);

  const [sessions, linkedEmails] = await Promise.all([
    db
      .select({
        id: chatSessions.id,
        title: chatSessions.title,
        status: chatSessions.status,
        updatedAt: chatSessions.updatedAt,
      })
      .from(chatSessions)
      .where(eq(chatSessions.taskId, id)),
    db
      .select({
        id: emailInbox.id,
        fromEmail: emailInbox.fromEmail,
        fromName: emailInbox.fromName,
        subject: emailInbox.subject,
        receivedAt: emailInbox.receivedAt,
        isRead: emailInbox.isRead,
      })
      .from(taskEmails)
      .innerJoin(emailInbox, eq(taskEmails.emailId, emailInbox.id))
      .where(eq(taskEmails.taskId, id)),
  ]);

  const lastRunAt = sessions.length > 0
    ? sessions.reduce((latest, s) =>
        s.updatedAt && (!latest || s.updatedAt > latest) ? s.updatedAt : latest,
        null as string | null,
      )
    : null;

  const nextRunAt =
    task.isCronEnabled && task.cronSchedule
      ? getNextRunSeconds(task.cronSchedule, lastRunAt ? new Date(lastRunAt) : null)
      : null;

  return successJson({ ...task, chatSessions: sessions, emails: linkedEmails, nextRunAt });
}

/**
 * @openapi
 * @operationId updateTask
 * @pathParams idParamSchema
 * @body updateTaskSchema
 * @response selectTaskSchema
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [updated] = await db
    .update(tasks)
    .set({ ...parsed.data, updatedAt: sql`(datetime('now'))` })
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)))
    .returning();

  if (!updated) return errorJson("Task not found", 404);

  // Sync cron schedule with Celery
  if (updated.isCronEnabled && updated.cronSchedule) {
    if (parsed.data.cronSchedule !== undefined) {
      await updateCronTask(id, updated.cronSchedule);
    } else {
      await registerCronTask(id, updated.cronSchedule);
    }
  } else if (parsed.data.isCronEnabled === false) {
    await deleteCronTask(id);
  }

  return successJson(updated);
}

/**
 * @openapi
 * @operationId deleteTask
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
    .delete(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Task not found", 404);

  await deleteCronTask(id);

  return successJson({ deleted: true });
}
