import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { webhookInbox } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import {
  updateWebhookSchema,
  selectWebhookSchema,
  deletedResponseSchema,
  idParamSchema,
} from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
/**
 * @openapi
 * @operationId getWebhook
 * @pathParams idParamSchema
 * @response selectWebhookSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [item] = await db
    .select()
    .from(webhookInbox)
    .where(and(eq(webhookInbox.id, id), eq(webhookInbox.userId, auth.userId)));

  if (!item) return errorJson("Webhook not found", 404);

  // Auto-mark as read on GET
  if (!item.isRead) {
    await db
      .update(webhookInbox)
      .set({ isRead: true })
      .where(and(eq(webhookInbox.id, id), eq(webhookInbox.userId, auth.userId)));
    item.isRead = true;
  }

  return successJson(item);
}

/**
 * @openapi
 * @operationId updateWebhook
 * @pathParams idParamSchema
 * @body updateWebhookSchema
 * @response selectWebhookSchema
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateWebhookSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [updated] = await db
    .update(webhookInbox)
    .set(parsed.data)
    .where(and(eq(webhookInbox.id, id), eq(webhookInbox.userId, auth.userId)))
    .returning();

  if (!updated) return errorJson("Webhook not found", 404);
  return successJson(updated);
}

/**
 * @openapi
 * @operationId deleteWebhook
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
    .delete(webhookInbox)
    .where(and(eq(webhookInbox.id, id), eq(webhookInbox.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Webhook not found", 404);
  return successJson({ deleted: true });
}
