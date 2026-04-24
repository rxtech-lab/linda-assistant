import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { briefings, briefingDocuments, documents } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import {
  selectBriefingSchema,
  deletedResponseSchema,
  idParamSchema,
  updateBriefingSchema,
} from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { withShareUrl } from "@/lib/utils/briefing";

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

  return successJson({ ...withShareUrl(briefing), documents: linkedDocs });
}

/**
 * @openapi
 * @operationId updateBriefing
 * @pathParams idParamSchema
 * @body updateBriefingSchema
 * @response selectBriefingSchema
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateBriefingSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return errorJson(msg, 422);
  }

  const [updated] = await db
    .update(briefings)
    .set({ isPublic: parsed.data.isPublic, updatedAt: sql`(datetime('now'))` })
    .where(and(eq(briefings.id, id), eq(briefings.userId, auth.userId)))
    .returning();

  if (!updated) return errorJson("Briefing not found", 404);

  return successJson(withShareUrl(updated));
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
