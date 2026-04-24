import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audios } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectAudioSchema, deletedResponseSchema, idParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId getAudio
 * @pathParams idParamSchema
 * @response selectAudioSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [audio] = await db
    .select()
    .from(audios)
    .where(and(eq(audios.id, id), eq(audios.userId, auth.userId)));

  if (!audio) return errorJson("Audio not found", 404);
  return successJson(audio);
}

/**
 * @openapi
 * @operationId deleteAudio
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
    .delete(audios)
    .where(and(eq(audios.id, id), eq(audios.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Audio not found", 404);
  return successJson({ deleted: true });
}
