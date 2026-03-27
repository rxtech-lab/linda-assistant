import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { webhookInbox } from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { insertWebhookSchema, selectWebhookSchema } from "@/lib/schemas";
import { parsePagination } from "@/lib/utils/pagination";
import { successJson, errorJson, paginatedJson } from "@/lib/utils/response";
import { z } from "zod";

const listResponseSchema = z.object({
  data: z.array(selectWebhookSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

/**
 * @openapi
 * @operationId listWebhooks
 * @response listResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { limit, offset } = parsePagination(request.nextUrl.searchParams);

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(webhookInbox)
      .where(eq(webhookInbox.userId, auth.userId))
      .orderBy(desc(webhookInbox.receivedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(webhookInbox)
      .where(eq(webhookInbox.userId, auth.userId)),
  ]);

  return paginatedJson(items, countResult[0].count, limit, offset);
}

/**
 * @openapi
 * @operationId createWebhook
 * @body insertWebhookSchema
 * @response 201:selectWebhookSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = insertWebhookSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [created] = await db
    .insert(webhookInbox)
    .values({ ...parsed.data, userId: auth.userId })
    .returning();

  return successJson(created, 201);
}
