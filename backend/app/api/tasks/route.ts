import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks, taskEmails, emailInbox, chatSessions } from "@/lib/db/schema";
import { eq, sql, and, inArray, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { insertTaskSchema, selectTaskSchema, taskSourceSchema } from "@/lib/schemas";
import { parsePagination } from "@/lib/utils/pagination";
import { successJson, errorJson, paginatedJson } from "@/lib/utils/response";
import { registerCronTask, scheduleOnceTask } from "@/lib/celery/client";
import { getNextRunSeconds } from "@/lib/utils/cron";
import { inheritAssigneeToolset } from "@/lib/db/task-toolset";
import { createAssigneeFollowUp } from "@/lib/utils/chat-session";
import { z } from "zod";

const listResponseSchema = z.object({
  data: z.array(selectTaskSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

/**
 * @openapi
 * @operationId listTasks
 * @response listResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const sourceParam = request.nextUrl.searchParams.get("source");
  const sourceFilter =
    sourceParam && taskSourceSchema.safeParse(sourceParam).success ? sourceParam : null;

  const whereClause = sourceFilter
    ? and(eq(tasks.userId, auth.userId), eq(tasks.source, sourceFilter))
    : eq(tasks.userId, auth.userId);

  const [items, countResult] = await Promise.all([
    db.select().from(tasks).where(whereClause).orderBy(desc(tasks.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(tasks).where(whereClause),
  ]);

  const itemsWithNextRun = items.map((task) => ({
    ...task,
    nextRunAt:
      task.isCronEnabled && task.cronSchedule ? getNextRunSeconds(task.cronSchedule) : null,
  }));

  // Derive status from active chat sessions
  const taskIds = items.map((t) => t.id);
  let activeTaskIds = new Set<string>();
  if (taskIds.length > 0) {
    const activeSessions = await db
      .select({ taskId: chatSessions.taskId })
      .from(chatSessions)
      .where(inArray(chatSessions.status, ["starting", "in_progress", "waiting_confirmation"]));
    activeTaskIds = new Set(
      activeSessions.filter((s) => s.taskId && taskIds.includes(s.taskId)).map((s) => s.taskId!),
    );
  }

  const itemsWithDerivedStatus = itemsWithNextRun.map((task) => ({
    ...task,
    status:
      task.status === "stopped" || task.status === "finished" || task.status === "cancelled"
        ? task.status
        : activeTaskIds.has(task.id)
          ? "running"
          : "pending",
  }));

  return paginatedJson(itemsWithDerivedStatus, countResult[0].count, limit, offset);
}

/**
 * @openapi
 * @operationId createTask
 * @body insertTaskSchema
 * @response 201:selectTaskSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = insertTaskSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    console.error("[Tasks] Validation error:", msg, parsed.error.issues);
    return errorJson(msg, 422);
  }

  const { emailId, execute, source, ...taskData } = parsed.data;

  // If emailId is provided but source isn't, default to "email"
  const resolvedSource = source ?? (emailId ? "email" : "manual");

  // Validate email exists and belongs to user if emailId provided
  if (emailId) {
    const [email] = await db
      .select()
      .from(emailInbox)
      .where(and(eq(emailInbox.id, emailId), eq(emailInbox.userId, auth.userId)));
    if (!email) {
      return errorJson("Email not found", 404);
    }
    // Email tasks require an assignee to process
    if (!taskData.assigneeId) {
      return errorJson("An assignee is required to create a task from an email", 422);
    }
  }

  const [created] = await db
    .insert(tasks)
    .values({ ...taskData, userId: auth.userId, status: "pending", source: resolvedSource })
    .returning();

  // Link email to task
  if (emailId) {
    await db.insert(taskEmails).values({ taskId: created.id, emailId });
  }

  // Inherit assignee's tool permissions and enabled extensions
  if (created.assigneeId) {
    const toolPermissions = await inheritAssigneeToolset(
      created.id,
      created.assigneeId,
      auth.userId,
    );
    if (toolPermissions) {
      await db.update(tasks).set({ toolPermissions }).where(eq(tasks.id, created.id));
      created.toolPermissions = toolPermissions;
    }
  }

  if (created.isCronEnabled && created.cronSchedule) {
    await registerCronTask(created.id, created.cronSchedule);
  }

  if (created.runsAt) {
    await scheduleOnceTask(created.id, created.runsAt);
  }

  // Immediately trigger execution if requested
  if (execute && created.assigneeId) {
    const message = created.description || created.title;
    await createAssigneeFollowUp(
      message,
      { userId: auth.userId, id: created.assigneeId },
      created.title,
      created.id,
    );
  }

  return successJson(created, 201);
}
