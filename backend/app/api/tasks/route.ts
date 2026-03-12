import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { insertTaskSchema, selectTaskSchema } from "@/lib/schemas";
import { parsePagination } from "@/lib/utils/pagination";
import { successJson, errorJson, paginatedJson } from "@/lib/utils/response";
import { registerCronTask } from "@/lib/celery/client";
import { getNextRunSeconds } from "@/lib/utils/cron";
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

  const [items, countResult] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.userId, auth.userId)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(tasks).where(eq(tasks.userId, auth.userId)),
  ]);

  const itemsWithNextRun = items.map((task) => ({
    ...task,
    nextRunAt:
      task.isCronEnabled && task.cronSchedule
        ? getNextRunSeconds(task.cronSchedule)
        : null,
  }));

  return paginatedJson(itemsWithNextRun, countResult[0].count, limit, offset);
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
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [created] = await db
    .insert(tasks)
    .values({ ...parsed.data, userId: auth.userId })
    .returning();

  if (created.isCronEnabled && created.cronSchedule) {
    await registerCronTask(created.id, created.cronSchedule);
  }

  return successJson(created, 201);
}
