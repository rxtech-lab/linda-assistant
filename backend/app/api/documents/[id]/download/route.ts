import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson } from "@/lib/utils/response";
import { replaceSlideTokens } from "@/lib/utils/markdown";

/**
 * GET /api/documents/[id]/download
 * Download a document with {{slide:id}} tokens expanded to image references.
 *
 * @openapi
 * @operationId downloadDocument
 * @pathParams idParamSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, auth.userId)));

  if (!doc) return errorJson("Document not found", 404);

  const format = doc.format === "html" ? "html" : "markdown";
  const processed = await replaceSlideTokens(doc.content, format);

  const ext = format === "html" ? "html" : "md";
  const safeTitle = doc.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "document";
  const contentType = format === "html" ? "text/html" : "text/markdown";

  return new NextResponse(processed, {
    headers: {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${safeTitle}.${ext}"`,
    },
  });
}
