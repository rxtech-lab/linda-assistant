import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { presignedUrlSchema, presignedUrlResponseSchema } from "@/lib/schemas";
import { getPresignedUploadUrl, getS3PublicUrl } from "@/lib/s3";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId createPresignedUrl
 * @body presignedUrlSchema
 * @response presignedUrlResponseSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = presignedUrlSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const result = await getPresignedUploadUrl(
    parsed.data.contentType,
    parsed.data.prefix,
    parsed.data.extension,
  );

  return successJson({ ...result, publicUrl: getS3PublicUrl(result.key) });
}
