import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import {
  idParamSchema,
  batchPresignedUrlSchema,
  batchPresignedUrlResponseSchema,
} from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";
import { getPresignedUploadUrls } from "@/lib/s3";

/**
 * @openapi
 * @operationId getUploadPresignedUrls
 * @pathParams idParamSchema
 * @body batchPresignedUrlSchema
 * @response batchPresignedUrlResponseSchema
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = batchPresignedUrlSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [upload] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.userId, auth.userId)));

  if (!upload) return errorJson("Upload not found", 404);
  if (upload.status !== "pending") return errorJson("Upload already resolved", 409);

  if (upload.numberUploads !== null && parsed.data.extensions.length !== upload.numberUploads) {
    return errorJson(
      `Expected ${upload.numberUploads} extensions, got ${parsed.data.extensions.length}`,
      422,
    );
  }

  const urls = await getPresignedUploadUrls(parsed.data.extensions);

  // Store the generated URLs on the upload record
  await db.update(uploads).set({ urls }).where(eq(uploads.id, id));

  return NextResponse.json(urls);
}
