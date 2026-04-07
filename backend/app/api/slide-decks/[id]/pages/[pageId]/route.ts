import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { successJson, errorJson } from "@/lib/utils/response";
import { renderAndUploadSlide } from "@/lib/slides";

/**
 * PUT /api/slide-decks/[id]/pages/[pageId]
 * Update a slide page's scene data and re-render.
 *
 * @openapi
 * /api/slide-decks/{id}/pages/{pageId}:
 *   put:
 *     summary: Update a slide page
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: pageId
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
 *     responses:
 *       200: { description: Slide page updated }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id: deckId, pageId } = await params;

  // Verify deck ownership
  const [deck] = await db
    .select()
    .from(slideDecks)
    .where(and(eq(slideDecks.id, deckId), eq(slideDecks.userId, auth.userId)));

  if (!deck) return errorJson("Slide deck not found", 404);

  // Find the page
  const [existing] = await db
    .select()
    .from(slidePages)
    .where(and(eq(slidePages.id, pageId), eq(slidePages.deckId, deckId)));

  if (!existing) return errorJson("Slide page not found", 404);

  let body: { sceneData?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  if (!body.sceneData) {
    return errorJson("sceneData is required", 400);
  }

  // Re-render and upload
  const { imageUrl, thumbnailUrl } = await renderAndUploadSlide(
    body.sceneData,
    deckId,
    existing.pageNumber,
  );

  // Update page
  const [updated] = await db
    .update(slidePages)
    .set({
      sceneData: body.sceneData,
      imageUrl,
      thumbnailUrl,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(slidePages.id, pageId))
    .returning();

  return successJson(updated);
}
