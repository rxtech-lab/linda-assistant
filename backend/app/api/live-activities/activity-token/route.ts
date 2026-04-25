import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { liveActivityTokens, tasks } from "@/lib/db/schema";
import {
  insertLiveActivityTokenSchema,
  selectLiveActivityTokenSchema,
} from "@/lib/schemas";
import { errorJson, successJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId registerLiveActivityToken
 * @body insertLiveActivityTokenSchema
 * @response 201:selectLiveActivityTokenSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = insertLiveActivityTokenSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.userId, auth.userId)));
  if (!task) return errorJson("Task not found", 404);

  const [upserted] = await db
    .insert(liveActivityTokens)
    .values({ ...parsed.data, userId: auth.userId })
    .onConflictDoUpdate({
      target: liveActivityTokens.activityId,
      set: {
        userId: auth.userId,
        taskId: parsed.data.taskId,
        token: parsed.data.token,
        endedAt: null,
        updatedAt: sql`(datetime('now'))`,
      },
    })
    .returning();

  return successJson(upserted, 201);
}
