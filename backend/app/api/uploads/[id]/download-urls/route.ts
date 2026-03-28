import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { idParamSchema, uploadDownloadUrlsResponseSchema } from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";
import { getPresignedDownloadUrl, getObjectContentType } from "@/lib/s3";

/**
 * @openapi
 * @operationId getUploadDownloadUrls
 * @pathParams idParamSchema
 * @response uploadDownloadUrlsResponseSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  // Verify upload belongs to user and is completed
  const [upload] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.userId, auth.userId)));

  if (!upload) return errorJson("Upload not found", 404);
  if (upload.status !== "completed") return errorJson("Upload not yet completed", 409);
  if (!upload.uploadedKeys || upload.uploadedKeys.length === 0) {
    return errorJson("No uploaded files found", 404);
  }

  const isE2E = process.env.IS_E2E?.toLowerCase() === "true";

  // Generate presigned download URLs and fetch MIME types for each uploaded key
  const downloadUrls = await Promise.all(
    upload.uploadedKeys.map(async (key) => {
      const ext = key.split(".").pop() ?? "";

      if (isE2E) {
        // In E2E mode, files aren't in S3 — return stub URLs and inferred MIME types
        const { extensionToMimeType } = await import("@/lib/s3");
        return {
          key,
          url: `http://localhost:${process.env.PORT || 3001}/api/mock-s3/${key}`,
          extension: ext,
          mimeType: extensionToMimeType(ext),
        };
      }

      const [url, mimeType] = await Promise.all([
        getPresignedDownloadUrl(key),
        getObjectContentType(key),
      ]);
      return {
        key,
        url,
        extension: ext,
        mimeType: mimeType ?? "application/octet-stream",
      };
    }),
  );

  return NextResponse.json(downloadUrls);
}
