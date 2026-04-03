import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { uploadBufferToS3 } from "@/lib/s3";
import { eq, asc } from "drizzle-orm";

// Dynamic import to avoid loading canvas native module at build time
async function getRenderer() {
  return import("./renderer");
}

/**
 * Render a slide's KonvaJS scene data to PNG + thumbnail, upload to S3, return URLs.
 */
export async function renderAndUploadSlide(
  sceneData: unknown,
  deckId: string,
  pageNumber: number,
): Promise<{ imageUrl: string; thumbnailUrl: string }> {
  const { renderSlideToBuffer, renderSlideThumbnail } = await getRenderer();
  const [imageBuffer, thumbBuffer] = await Promise.all([
    renderSlideToBuffer(sceneData),
    renderSlideThumbnail(sceneData),
  ]);

  const ts = Date.now();
  const [{ url: imageUrl }, { url: thumbnailUrl }] = await Promise.all([
    uploadBufferToS3(imageBuffer, "image/png", `slide-${deckId}-p${pageNumber}-${ts}.png`, "slides"),
    uploadBufferToS3(
      thumbBuffer,
      "image/png",
      `slide-${deckId}-p${pageNumber}-thumb-${ts}.png`,
      "slides",
    ),
  ]);

  return { imageUrl, thumbnailUrl };
}

/**
 * Generate a PDF from all pages of a slide deck.
 * Embeds each rendered slide image as a full-page in the PDF.
 */
export async function renderDeckToPDF(deckId: string): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const { renderSlideToBuffer } = await getRenderer();

  const pages = await db
    .select()
    .from(slidePages)
    .where(eq(slidePages.deckId, deckId))
    .orderBy(asc(slidePages.pageNumber));

  const pdfDoc = await PDFDocument.create();

  for (const page of pages) {
    // Re-render from sceneData for best quality
    const pngBuffer = page.sceneData
      ? await renderSlideToBuffer(page.sceneData)
      : page.imageUrl
        ? await fetchImageBuffer(page.imageUrl)
        : null;

    if (!pngBuffer) continue;

    const pngImage = await pdfDoc.embedPng(pngBuffer);
    // 16:9 landscape at 72 DPI
    const pdfPage = pdfDoc.addPage([1920 * 0.5, 1080 * 0.5]); // 960x540 points
    pdfPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pdfPage.getWidth(),
      height: pdfPage.getHeight(),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Generate a PPTX from all pages of a slide deck.
 */
export async function renderDeckToPPTX(deckId: string): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const { renderSlideToBuffer } = await getRenderer();

  const [deck] = await db.select().from(slideDecks).where(eq(slideDecks.id, deckId));
  const pages = await db
    .select()
    .from(slidePages)
    .where(eq(slidePages.deckId, deckId))
    .orderBy(asc(slidePages.pageNumber));

  const pptx = new PptxGenJS();
  pptx.title = deck?.title ?? "Slides";
  pptx.layout = "LAYOUT_WIDE"; // 13.33" x 7.5" (16:9)

  for (const page of pages) {
    const pngBuffer = page.sceneData
      ? await renderSlideToBuffer(page.sceneData)
      : page.imageUrl
        ? await fetchImageBuffer(page.imageUrl)
        : null;

    if (!pngBuffer) continue;

    const slide = pptx.addSlide();
    const base64 = pngBuffer.toString("base64");
    slide.addImage({
      data: `image/png;base64,${base64}`,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
    });
  }

  const arrayBuffer = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return Buffer.from(arrayBuffer);
}

/**
 * Fetch an image from a URL and return as Buffer.
 */
async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
