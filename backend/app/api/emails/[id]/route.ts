import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { emailInbox } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { updateEmailSchema, selectEmailSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { z } from "zod";

const detailResponseSchema = z.object({ data: selectEmailSchema });

/**
 * @openapi
 * @response 200 - detailResponseSchema
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [item] = await db
    .select()
    .from(emailInbox)
    .where(and(eq(emailInbox.id, id), eq(emailInbox.userId, auth.userId)));

  if (!item) return errorJson("Email not found", 404);
  return successJson(item);
}

/**
 * @openapi
 * @body updateEmailSchema
 * @response 200 - detailResponseSchema
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateEmailSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [updated] = await db
    .update(emailInbox)
    .set(parsed.data)
    .where(and(eq(emailInbox.id, id), eq(emailInbox.userId, auth.userId)))
    .returning();

  if (!updated) return errorJson("Email not found", 404);
  return successJson(updated);
}

/**
 * @openapi
 * @response 200 - z.object({ data: z.object({ deleted: z.boolean() }) })
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [deleted] = await db
    .delete(emailInbox)
    .where(and(eq(emailInbox.id, id), eq(emailInbox.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Email not found", 404);
  return successJson({ deleted: true });
}

