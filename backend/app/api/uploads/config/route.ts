import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { uploadConfigResponseSchema } from "@/lib/schemas";
import { successJson } from "@/lib/utils/response";
import { extensionToMimeType } from "@/lib/s3";

const ACCEPTED_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
  "csv",
  "xlsx",
  "xls",
  "docx",
  "doc",
  "txt",
  "md",
];

const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * @openapi
 * @operationId getUploadConfig
 * @response uploadConfigResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  return successJson({
    maxSizeBytes: MAX_SIZE_BYTES,
    acceptedExtensions: ACCEPTED_EXTENSIONS,
    acceptedMimeTypes: ACCEPTED_EXTENSIONS.map((ext) => extensionToMimeType(ext)),
  });
}
