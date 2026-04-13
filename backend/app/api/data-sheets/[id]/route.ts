import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { dataSheets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * GET /api/data-sheets/[id]
 * Returns a data sheet's metadata (without inline data).
 *
 * @openapi
 * /api/data-sheets/{id}:
 *   get:
 *     summary: Get data sheet metadata
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Data sheet metadata }
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [sheet] = await db
    .select({
      id: dataSheets.id,
      userId: dataSheets.userId,
      chatSessionId: dataSheets.chatSessionId,
      title: dataSheets.title,
      description: dataSheets.description,
      columns: dataSheets.columns,
      rowCount: dataSheets.rowCount,
      createdAt: dataSheets.createdAt,
      updatedAt: dataSheets.updatedAt,
    })
    .from(dataSheets)
    .where(and(eq(dataSheets.id, id), eq(dataSheets.userId, auth.userId)));

  if (!sheet) return errorJson("Data sheet not found", 404);

  return successJson(sheet);
}

/**
 * DELETE /api/data-sheets/[id]
 * Deletes a data sheet.
 *
 * @openapi
 * /api/data-sheets/{id}:
 *   delete:
 *     summary: Delete a data sheet
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Data sheet deleted }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [deleted] = await db
    .delete(dataSheets)
    .where(and(eq(dataSheets.id, id), eq(dataSheets.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Data sheet not found", 404);
  return successJson({ deleted: true });
}
