import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson, successJson } from "@/lib/utils/response";
import { getCronTask } from "@/lib/celery/client";
import { z } from "zod";

const celeryScheduleResponseSchema = z.object({
  taskId: z.string(),
  cronSchedule: z.string().nullable(),
  timezone: z.string().nullable(),
  registered: z.boolean().describe("Whether Celery has a live entry for this task"),
});

/**
 * @openapi
 * @operationId getTaskCelerySchedule
 * @pathParams idParamSchema
 * @response celeryScheduleResponseSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)));

  if (!task) return errorJson("Task not found", 404);

  const schedule = await getCronTask(id);
  if (!schedule) {
    return successJson({
      taskId: id,
      cronSchedule: null,
      timezone: null,
      registered: false,
    });
  }

  return successJson({
    taskId: schedule.task_id,
    cronSchedule: schedule.cron_schedule,
    timezone: schedule.timezone,
    registered: true,
  });
}
