import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson } from "@/lib/utils/response";
import { renderAndUploadSlide } from "@/lib/slides";
import { isPptxSlideSpec, parsePptxSlideSpec, toKonvaSceneData } from "@/lib/slides/spec";

/**
 * POST /api/slide-decks/[id]/pages/[pageId]/render
 * Render a slide page to PNG. Optionally upload to S3 and update DB.
 *
 * @openapi
 * /api/slide-decks/{id}/pages/{pageId}/render:
 *   post:
 *     summary: Render a slide page to PNG
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: pageId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: upload
 *         schema: { type: boolean }
 *         description: Upload to S3 and update DB when true
 *     responses:
 *       200: { description: Rendered PNG image }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id: deckId, pageId } = await params;
  const shouldUpload = request.nextUrl.searchParams.get("upload") === "true";

  // Verify deck ownership
  const [deck] = await db
    .select()
    .from(slideDecks)
    .where(and(eq(slideDecks.id, deckId), eq(slideDecks.userId, auth.userId)));

  if (!deck) return errorJson("Slide deck not found", 404);

  // Find the page
  const [page] = await db
    .select()
    .from(slidePages)
    .where(and(eq(slidePages.id, pageId), eq(slidePages.deckId, deckId)));

  if (!page) return errorJson("Slide page not found", 404);
  if (!page.sceneData) return errorJson("Slide page has no scene data", 400);

  // Dynamic import to avoid loading canvas at build time
  const { renderSlideToBuffer } = await import("@/lib/slides/renderer");
  const renderData = isPptxSlideSpec(page.sceneData)
    ? toKonvaSceneData(parsePptxSlideSpec(page.sceneData))
    : page.sceneData;
  const pngBuffer = await renderSlideToBuffer(renderData);

  const headers: Record<string, string> = {
    "Content-Type": "image/png",
    "Content-Disposition": `inline; filename="slide-${deckId}-p${page.pageNumber}.png"`,
  };

  // Optionally upload to S3 and update DB
  if (shouldUpload) {
    const { imageUrl, thumbnailUrl } = await renderAndUploadSlide(
      page.sceneData,
      deckId,
      page.pageNumber,
    );

    await db
      .update(slidePages)
      .set({
        imageUrl,
        thumbnailUrl,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(slidePages.id, pageId));

    headers["X-Image-Url"] = imageUrl;
    headers["X-Thumbnail-Url"] = thumbnailUrl;
  }

  return new NextResponse(new Uint8Array(pngBuffer), { headers });
}
