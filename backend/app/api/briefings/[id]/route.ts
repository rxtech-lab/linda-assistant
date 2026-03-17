import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { briefings, briefingDocuments, documents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectBriefingSchema, deletedResponseSchema, idParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId getBriefing
 * @pathParams idParamSchema
 * @response selectBriefingSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [briefing] = await db
    .select()
    .from(briefings)
    .where(and(eq(briefings.id, id), eq(briefings.userId, auth.userId)));

  if (!briefing) return errorJson("Briefing not found", 404);

  // Fetch linked documents
  const linkedDocs = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      chatSessionId: documents.chatSessionId,
      title: documents.title,
      format: documents.format,
      content: documents.content,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(briefingDocuments)
    .innerJoin(documents, eq(briefingDocuments.documentId, documents.id))
    .where(eq(briefingDocuments.briefingId, id));

  return successJson({ ...briefing, documents: linkedDocs });
}

/**
 * @openapi
 * @operationId deleteBriefing
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
    .delete(briefings)
    .where(and(eq(briefings.id, id), eq(briefings.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Briefing not found", 404);
  return successJson({ deleted: true });
}
