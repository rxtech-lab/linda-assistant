import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectTaskSchema, idParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId startTask
 * @pathParams idParamSchema
 * @response selectTaskSchema
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)));
  if (!existing) return errorJson("Task not found", 404);
  if (existing.status === "pending")
    return errorJson("Task is already pending", 400);

  const [updated] = await db
    .update(tasks)
    .set({ status: "pending", updatedAt: sql`(datetime('now'))` })
    .where(and(eq(tasks.id, id), eq(tasks.userId, auth.userId)))
    .returning();

  if (!updated) return errorJson("Task not found", 404);

  return successJson(updated);
}
