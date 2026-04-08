import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { deleteUploadObjectSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { deleteObject } from "@/lib/s3";

/**
 * @openapi
 * @operationId deleteUploadObject
 * @body deleteUploadObjectSchema
 */
export async function DELETE(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = deleteUploadObjectSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  // Only allow deleting user-uploaded objects
  if (!parsed.data.key.startsWith("user-uploads/")) {
    return errorJson("Cannot delete objects outside user-uploads/", 403);
  }

  await deleteObject(parsed.data.key);

  return successJson({ deleted: true });
}
