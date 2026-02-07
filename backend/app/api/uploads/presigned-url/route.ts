import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { presignedUrlSchema } from "@/lib/schemas";
import { getPresignedUploadUrl } from "@/lib/s3";
import { successJson, errorJson } from "@/lib/utils/response";
import { z } from "zod";

const presignedUrlResponseSchema = z.object({
  data: z.object({
    url: z.string(),
    key: z.string(),
  }),
});

/**
 * @openapi
 * @body presignedUrlSchema
 * @response 200 - presignedUrlResponseSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = presignedUrlSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const result = await getPresignedUploadUrl(
    parsed.data.contentType,
    parsed.data.prefix
  );

  return successJson(result);
}

