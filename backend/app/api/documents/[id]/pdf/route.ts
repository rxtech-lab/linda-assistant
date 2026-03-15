import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson } from "@/lib/utils/response";
import { generateDocumentPdf, sanitizeDocumentFilename } from "@/lib/documents/pdf";

/**
 * @openapi
 * @operationId getDocumentPdf
 * @pathParams idParamSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  // Verify ownership before generating PDF
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, auth.userId)));

  if (!doc) return errorJson("Document not found", 404);

  const { buffer, title } = await generateDocumentPdf(id);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${sanitizeDocumentFilename(title)}"`,
    },
  });
}
