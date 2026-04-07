import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { eq, and, max } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { successJson, errorJson } from "@/lib/utils/response";
import { renderAndUploadSlide } from "@/lib/slides";

/**
 * POST /api/slide-decks/[id]/pages
 * Add a new page to a slide deck.
 *
 * @openapi
 * /api/slide-decks/{id}/pages:
 *   post:
 *     summary: Add a slide page with scene data
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sceneData]
 *             properties:
 *               sceneData: {}
 *               pageNumber: { type: integer }
 *     responses:
 *       201: { description: Slide page created }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id: deckId } = await params;

  // Verify deck ownership
  const [deck] = await db
    .select()
    .from(slideDecks)
    .where(and(eq(slideDecks.id, deckId), eq(slideDecks.userId, auth.userId)));

  if (!deck) return errorJson("Slide deck not found", 404);

  let body: { sceneData?: unknown; pageNumber?: number };
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  if (!body.sceneData) {
    return errorJson("sceneData is required", 400);
  }

  // Determine page number
  let pageNumber = body.pageNumber;
  if (pageNumber == null) {
    const [result] = await db
      .select({ maxPage: max(slidePages.pageNumber) })
      .from(slidePages)
      .where(eq(slidePages.deckId, deckId));
    pageNumber = (result?.maxPage ?? 0) + 1;
  }

  // Render and upload
  const { imageUrl, thumbnailUrl } = await renderAndUploadSlide(
    body.sceneData,
    deckId,
    pageNumber,
  );

  // Insert page
  const [page] = await db
    .insert(slidePages)
    .values({
      deckId,
      pageNumber,
      sceneData: body.sceneData,
      imageUrl,
      thumbnailUrl,
    })
    .returning();

  return successJson(page, 201);
}
