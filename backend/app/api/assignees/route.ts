import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees } from "@/lib/db/schema";
import { eq, sql, and, or, like } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { NO_PERMISSION_CHANGE_TOOLS } from "@/lib/ai/tools";
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
  const search = request.nextUrl.searchParams.get("search");

  const baseWhere = search
    ? and(
        eq(assignees.userId, auth.userId),
        or(like(assignees.name, `%${search}%`), like(assignees.email, `%${search}%`)),
      )
    : eq(assignees.userId, auth.userId);

  const [items, countResult] = await Promise.all([
    db.select().from(assignees).where(baseWhere).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(assignees).where(baseWhere),
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

  // Reject duplicate email addresses (globally unique for webhook routing)
  const [existing] = await db
    .select({ id: assignees.id })
    .from(assignees)
    .where(eq(assignees.email, parsed.data.email));
  if (existing) {
    return errorJson("An assignee with this email address already exists", 409);
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

  const [created] = await db
    .insert(assignees)
    .values({ ...parsed.data, userId: auth.userId })
    .returning();

  return successJson(created, 201);
}
