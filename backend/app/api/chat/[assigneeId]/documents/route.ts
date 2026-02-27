import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees, chatSessions, documents } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { assigneeIdParamSchema, selectDocumentSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { z } from "zod";

const listResponseSchema = z.object({
  data: z.array(selectDocumentSchema),
});

/**
 * List documents from an assignee's persistent chat session.
 *
 * @openapi
 * @operationId listChatDocuments
 * @pathParams assigneeIdParamSchema
 * @response listResponseSchema
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assigneeId: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { assigneeId } = await params;

  // Verify assignee belongs to user
  const [assignee] = await db
    .select({ id: assignees.id })
    .from(assignees)
    .where(
      and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)),
    );

  if (!assignee) return errorJson("Assignee not found", 404);

  // Find existing session
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.assigneeId, assigneeId),
        eq(chatSessions.userId, auth.userId),
      ),
    )
    .limit(1);

  if (!session) return successJson({ data: [] });

  const items = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.userId, auth.userId),
        eq(documents.chatSessionId, session.id),
      ),
    )
    .orderBy(desc(documents.createdAt));

  return successJson({ data: items });
}
