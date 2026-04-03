import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * GET /api/slide-decks/[id]
 * Returns a slide deck with all its pages ordered by page number.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [deck] = await db
    .select()
    .from(slideDecks)
    .where(and(eq(slideDecks.id, id), eq(slideDecks.userId, auth.userId)));

  if (!deck) return errorJson("Slide deck not found", 404);

  const pages = await db
    .select({
      id: slidePages.id,
      deckId: slidePages.deckId,
      pageNumber: slidePages.pageNumber,
      imageUrl: slidePages.imageUrl,
      thumbnailUrl: slidePages.thumbnailUrl,
      createdAt: slidePages.createdAt,
      updatedAt: slidePages.updatedAt,
    })
    .from(slidePages)
    .where(eq(slidePages.deckId, id))
    .orderBy(asc(slidePages.pageNumber));

  return successJson({ ...deck, pages });
}

/**
 * DELETE /api/slide-decks/[id]
 * Deletes a slide deck and all its pages (cascade).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [deleted] = await db
    .delete(slideDecks)
    .where(and(eq(slideDecks.id, id), eq(slideDecks.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Slide deck not found", 404);
  return successJson({ deleted: true });
}
