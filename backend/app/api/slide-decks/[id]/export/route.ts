import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson, successJson } from "@/lib/utils/response";
import { renderDeckToPDF, renderDeckToPPTX } from "@/lib/slides";

/**
 * GET /api/slide-decks/[id]/export?format=pdf|pptx|images
 * Export a slide deck in the requested format.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const format = request.nextUrl.searchParams.get("format") ?? "pdf";

  // Verify ownership
  const [deck] = await db
    .select()
    .from(slideDecks)
    .where(and(eq(slideDecks.id, id), eq(slideDecks.userId, auth.userId)));

  if (!deck) return errorJson("Slide deck not found", 404);

  const safeTitle = deck.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "slides";

  switch (format) {
    case "pdf": {
      const buffer = await renderDeckToPDF(id);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeTitle}.pdf"`,
        },
      });
    }

    case "pptx": {
      const buffer = await renderDeckToPPTX(id);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename="${safeTitle}.pptx"`,
        },
      });
    }

    case "images": {
      const pages = await db
        .select({
          pageNumber: slidePages.pageNumber,
          imageUrl: slidePages.imageUrl,
        })
        .from(slidePages)
        .where(eq(slidePages.deckId, id))
        .orderBy(asc(slidePages.pageNumber));

      return successJson(pages.map((p) => ({ pageNumber: p.pageNumber, imageUrl: p.imageUrl })));
    }

    default:
      return errorJson("Invalid format. Use: pdf, pptx, or images", 400);
  }
}
