import { authenticate } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { errorJson, successJson } from "@/lib/utils/response";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
/**
 * @openapi
 * @operationId getChatSession
 * @pathParams idParamSchema
 * @response selectChatSessionSchema
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [item] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId)));

  if (!item) return errorJson("Chat session not found", 404);
  return successJson(item);
}

/**
 * @openapi
 * @operationId deleteChatSession
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
    .delete(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Chat session not found", 404);
  return successJson({ deleted: true });
}
