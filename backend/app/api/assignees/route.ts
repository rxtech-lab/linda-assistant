import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { insertAssigneeSchema, selectAssigneeSchema } from "@/lib/schemas";
import { parsePagination } from "@/lib/utils/pagination";
import { successJson, errorJson, paginatedJson } from "@/lib/utils/response";
import { z } from "zod";

/**
 * @openapi
 * @operationId listAssignees
 * @response listResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { limit, offset } = parsePagination(request.nextUrl.searchParams);

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(assignees)
      .where(eq(assignees.userId, auth.userId))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(assignees)
      .where(eq(assignees.userId, auth.userId)),
  ]);

  return paginatedJson(items, countResult[0].count, limit, offset);
}

/**
 * @openapi
 * @operationId createAssignee
 * @body insertAssigneeSchema
 * @response 201:selectAssigneeSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = insertAssigneeSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.message, 422);
  }

  const [created] = await db
    .insert(assignees)
    .values({ ...parsed.data, userId: auth.userId })
    .returning();

  return successJson(created, 201);
}
