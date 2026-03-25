import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  tasks,
  chatSessions,
  taskEmails,
  emailInbox,
  taskExtensions,
  extensions,
} from "@/lib/db/schema";
import { eq, and, sql, or, inArray, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { NO_PERMISSION_CHANGE_TOOLS } from "@/lib/ai/tools";
import {
  updateTaskSchema,
  selectTaskSchema,
  deletedResponseSchema,
  idParamSchema,
} from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import {
  registerCronTask,
  updateCronTask,
  deleteCronTask,
  scheduleOnceTask,
} from "@/lib/celery/client";
import { getNextRunSeconds } from "@/lib/utils/cron";
import { z } from "zod";

const taskDetailSchema = selectTaskSchema.extend({
  chatSessions: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      status: z.string().nullable(),
      createdAt: z.string().nullable(),
      updatedAt: z.string().nullable(),
    }),
  ),
  emails: z.array(z.any()),
  enabledExtensions: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        prefix: z.string(),
      }),
    )
    .optional(),
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

  const [sessions, linkedEmails, teRows] = await Promise.all([
    db
      .select({
        id: chatSessions.id,
        title: chatSessions.title,
        status: chatSessions.status,
        createdAt: chatSessions.createdAt,
        updatedAt: chatSessions.updatedAt,
      })
      .from(chatSessions)
      .where(eq(chatSessions.taskId, id))
      .orderBy(desc(chatSessions.createdAt))
      .limit(10),
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
    db.select().from(taskExtensions).where(eq(taskExtensions.taskId, id)),
  ]);

  // Build enabled extensions list
  const enabledExtensionIds = teRows.filter((te) => te.enabled).map((te) => te.extensionId);
  let enabledExtensions: Array<{ id: string; title: string; prefix: string }> = [];
  if (enabledExtensionIds.length > 0) {
    enabledExtensions = await db
      .select({
        id: extensions.id,
        title: extensions.title,
        prefix: extensions.prefix,
      })
      .from(extensions)
      .where(
        and(
          inArray(extensions.id, enabledExtensionIds),
          or(eq(extensions.type, "system"), eq(extensions.userId, auth.userId)),
        ),
      );
  }

  const lastRunAt =
    sessions.length > 0
      ? sessions.reduce(
          (latest, s) => (s.updatedAt && (!latest || s.updatedAt > latest) ? s.updatedAt : latest),
          null as string | null,
        )
      : null;

  const nextRunAt =
    task.isCronEnabled && task.cronSchedule
      ? getNextRunSeconds(task.cronSchedule, lastRunAt ? new Date(lastRunAt) : null)
      : null;

  // Derive status from active chat sessions
  const hasActiveSession = sessions.some(
    (s) => s.status && ["starting", "in_progress", "waiting_confirmation"].includes(s.status),
  );
  const derivedStatus =
    task.status === "stopped" || task.status === "finished" || task.status === "cancelled"
      ? task.status
      : hasActiveSession
        ? "running"
        : "pending";

  return successJson({
    ...task,
    status: derivedStatus,
    chatSessions: sessions,
    emails: linkedEmails,
    nextRunAt,
    enabledExtensions,
  });
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
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    console.error("[Tasks] Validation error:", msg, parsed.error.issues);
    return errorJson(msg, 422);
  }

  // Reject permission changes for system tools that always auto-execute
  if (parsed.data.toolPermissions) {
    const forbidden = parsed.data.toolPermissions
      .filter((tp) => NO_PERMISSION_CHANGE_TOOLS.has(tp.toolName))
      .map((tp) => tp.toolName);
    if (forbidden.length > 0) {
      return errorJson(`Cannot change permissions for system tools: ${forbidden.join(", ")}`, 400);
    }
  }

  // Check mutual exclusivity against existing task state
  const [existing] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)));
  if (!existing) return errorJson("Task not found", 404);

  // Clear conflicting fields when switching schedule type
  const updates: Record<string, unknown> = {
    ...parsed.data,
    updatedAt: sql`(datetime('now'))`,
  };
  if (parsed.data.isCronEnabled && parsed.data.runsAt === undefined) {
    updates.runsAt = null; // Switching to cron → clear runsAt
  }
  if (parsed.data.runsAt && parsed.data.isCronEnabled === undefined) {
    updates.isCronEnabled = false; // Setting runsAt → disable cron
    updates.cronSchedule = null;
  }

  // Validate after auto-clear: reject only explicit conflicts
  const willBeCron = (updates.isCronEnabled as boolean | undefined) ?? existing.isCronEnabled;
  const willHaveRunsAt = updates.runsAt !== undefined ? updates.runsAt : existing.runsAt;
  if (willBeCron && willHaveRunsAt) {
    return errorJson("A task cannot have both cron scheduling and a one-shot runsAt schedule", 422);
  }

  const [updated] = await db
    .update(tasks)
    .set(updates)
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
  } else if (parsed.data.isCronEnabled === false || parsed.data.runsAt) {
    await deleteCronTask(id);
  }

  if (parsed.data.runsAt !== undefined && updated.runsAt) {
    await scheduleOnceTask(id, updated.runsAt);
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
