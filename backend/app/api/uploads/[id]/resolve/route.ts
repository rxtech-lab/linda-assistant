import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { resolveUploadSchema, resolveUploadResponseSchema, idParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { resolveUploadRequest } from "@/lib/ai/upload";

/**
 * @openapi
 * @operationId resolveUpload
 * @pathParams idParamSchema
 * @body resolveUploadSchema
 * @response resolveUploadResponseSchema
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = resolveUploadSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  // Validate that uploadedKeys are provided when action is "complete"
  if (
    parsed.data.action === "complete" &&
    (!parsed.data.uploadedKeys || parsed.data.uploadedKeys.length === 0)
  ) {
    return errorJson("uploadedKeys are required when action is 'complete'", 422);
  }

  console.log(`[Upload] Upload parsed success: id=${id} action=${parsed.data.action}`);

  // Verify upload belongs to user
  const [upload] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.userId, auth.userId)));

  if (!upload) return errorJson("Upload not found", 404);
  if (upload.status !== "pending") return errorJson("Upload already resolved", 409);

  const result = await resolveUploadRequest(id, parsed.data.action, parsed.data.uploadedKeys);
  console.log(
    `[Upload] Resolved: id=${id} action=${parsed.data.action} result=${JSON.stringify(result)}`,
  );
  return successJson(result);
}
