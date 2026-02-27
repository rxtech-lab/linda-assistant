import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson } from "@/lib/utils/response";
import escapeHtml from "escape-html";
import { marked } from "marked";
import puppeteer from "puppeteer";

/**
 * @openapi
 * @operationId getDocumentPdf
 * @pathParams idParamSchema
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, auth.userId)));

  if (!doc) return errorJson("Document not found", 404);

  // Convert content to HTML
  let htmlContent: string;
  if (doc.format === "markdown") {
    htmlContent = await marked(doc.content);
  } else {
    htmlContent = doc.content;
  }

  // Wrap in full HTML document with styling
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(doc.title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 { font-size: 2em; margin-bottom: 0.5em; }
    h2 { font-size: 1.5em; margin-top: 1.5em; }
    h3 { font-size: 1.2em; margin-top: 1.2em; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background-color: #f5f5f5; }
    pre { background-color: #f5f5f5; padding: 16px; border-radius: 4px; overflow-x: auto; }
    code { background-color: #f5f5f5; padding: 2px 4px; border-radius: 2px; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #666; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  <h1>${escapeHtml(doc.title)}</h1>
  ${htmlContent}
</body>
</html>`;

  // Render with Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${doc.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "document"}.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}
