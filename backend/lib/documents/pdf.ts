import http from "node:http";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import escapeHtml from "escape-html";
import { marked } from "marked";
import puppeteer from "puppeteer";
import { replaceSlideTokens } from "@/lib/utils/markdown";

/** Sanitize a document title into a safe PDF filename. */
export function sanitizeDocumentFilename(title: string): string {
  return `${title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "document"}.pdf`;
}

/**
 * Generate a PDF from a document stored in the database.
 * Caller is responsible for authorization checks before calling this function.
 */
export async function generateDocumentPdf(
  documentId: string,
): Promise<{ buffer: Buffer; title: string }> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));

  if (!doc) throw new Error("Document not found");

  // In E2E mode, return a minimal PDF buffer to avoid puppeteer dependency
  if (process.env.IS_E2E) {
    return { buffer: Buffer.from("%PDF-1.0 mock"), title: doc.title };
  }

  // Strip any full-HTML wrapper the AI may have embedded in the content
  function extractBodyContent(raw: string): string {
    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) return bodyMatch[1].trim();
    return raw
      .replace(/<!DOCTYPE[^>]*>/gi, "")
      .replace(/<html[^>]*>/gi, "")
      .replace(/<\/html>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/?body[^>]*>/gi, "")
      .trim();
  }

  // Convert content to HTML
  let htmlContent: string;
  if (doc.format === "html") {
    htmlContent = extractBodyContent(doc.content);
  } else {
    // Parse markdown to HTML, then strip any HTML wrappers the AI may have included
    const rawHtml = await marked(doc.content);
    htmlContent = extractBodyContent(rawHtml);
  }

  // Replace {{slide:id}} syntax with rendered slide images
  htmlContent = await replaceSlideTokens(htmlContent, "html");

  // The headless Chrome Docker image renders all <head> content (<style>, <title>)
  // as visible text in PDFs, and addStyleTag also fails (puppeteer #8781).
  // Workaround: inject styles via page.evaluate() directly on DOM elements.
  const fullHtml = `<!DOCTYPE html>
<html>
<body>
  <h1>${escapeHtml(doc.title)}</h1>
  <hr>
  ${htmlContent}
</body>
</html>`;

  const chromeUrl = process.env.CHROME_URL;
  if (!chromeUrl) throw new Error("CHROME_URL environment variable is required");

  // Query Chrome's /json/version to get the full WebSocket debugger URL.
  // Chrome rejects non-localhost Host headers on its HTTP API, and Bun's fetch
  // silently ignores Host overrides (forbidden header). Use node:http instead.
  const chromeHttpUrl = new URL(chromeUrl.replace(/^ws:\/\//, "http://"));
  const { webSocketDebuggerUrl } = await new Promise<{ webSocketDebuggerUrl: string }>(
    (resolve, reject) => {
      const req = http.get(
        {
          hostname: chromeHttpUrl.hostname,
          port: chromeHttpUrl.port,
          path: "/json/version",
          headers: { Host: "localhost" },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => (body += chunk.toString()));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error(`Chrome /json/version returned invalid JSON: ${body}`));
            }
          });
        },
      );
      req.on("error", reject);
    },
  );
  // Replace the advertised host (localhost) with the configured host
  const browserWSEndpoint = webSocketDebuggerUrl.replace(
    /ws:\/\/[^/]+/,
    `ws://${chromeHttpUrl.host}`,
  );

  const browser = await puppeteer.connect({ browserWSEndpoint });

  const page = await browser.newPage();
  try {
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });

    // Apply styles via JS — no <style> tags (Chrome Docker bug renders them as
    // text in PDFs and also doesn't apply default block-level display).
    await page.evaluate(() => {
      const s = document.body.style;
      s.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      s.maxWidth = "800px";
      s.margin = "0 auto";
      s.padding = "0";
      s.lineHeight = "1.6";
      s.color = "#333";

      // Force block display on all standard block elements
      const blockTags =
        "p,h1,h2,h3,h4,h5,h6,div,ul,ol,li,blockquote,pre,table,thead,tbody,tfoot,hr,figure,figcaption,section,article,header,footer,nav,main,details,summary";
      document.querySelectorAll(blockTags).forEach((el) => {
        (el as HTMLElement).style.display = "block";
      });
      // Table elements need specific display types
      document.querySelectorAll("table").forEach((el) => {
        el.style.display = "table";
        el.style.borderCollapse = "collapse";
        el.style.width = "100%";
        el.style.margin = "1em 0";
      });
      document.querySelectorAll("thead").forEach((el) => {
        el.style.display = "table-header-group";
      });
      document.querySelectorAll("tbody").forEach((el) => {
        el.style.display = "table-row-group";
      });
      document.querySelectorAll("tr").forEach((el) => {
        el.style.display = "table-row";
      });
      document.querySelectorAll("th, td").forEach((el) => {
        const s = (el as HTMLElement).style;
        s.display = "table-cell";
        s.border = "1px solid #ddd";
        s.padding = "8px 12px";
        s.textAlign = "left";
      });

      // Custom styles
      const styles: Record<string, Record<string, string>> = {
        h1: { fontSize: "2em", marginBottom: "0.5em", marginTop: "0" },
        h2: { fontSize: "1.5em", marginTop: "1.5em" },
        h3: { fontSize: "1.2em", marginTop: "1.2em" },
        p: { marginTop: "0.5em", marginBottom: "0.5em" },
        hr: {
          border: "none",
          borderTop: "1px solid #ddd",
          margin: "0.8em 0 1.5em 0",
        },
        th: { backgroundColor: "#f5f5f5", fontWeight: "bold" },
        pre: {
          backgroundColor: "#f5f5f5",
          padding: "16px",
          borderRadius: "4px",
          overflowX: "auto",
        },
        code: {
          backgroundColor: "#f5f5f5",
          padding: "2px 4px",
          borderRadius: "2px",
          fontSize: "0.9em",
        },
        blockquote: {
          borderLeft: "4px solid #ddd",
          margin: "1em 0",
          padding: "0.5em 1em",
          color: "#666",
        },
        ul: { paddingLeft: "2em", marginTop: "0.5em", marginBottom: "0.5em" },
        ol: { paddingLeft: "2em", marginTop: "0.5em", marginBottom: "0.5em" },
        li: { display: "list-item" },
        img: { maxWidth: "100%" },
      };

      for (const [tag, props] of Object.entries(styles)) {
        document.querySelectorAll(tag).forEach((el) => {
          Object.assign((el as HTMLElement).style, props);
        });
      }

      // Reset code inside pre
      document.querySelectorAll("pre code").forEach((el) => {
        const s = (el as HTMLElement).style;
        s.background = "none";
        s.padding = "0";
      });
    });

    const cdp = await page.createCDPSession();
    const { data } = await cdp.send("Page.printToPDF", {
      printBackground: true,
      paperWidth: 8.27, // A4
      paperHeight: 11.69,
      marginTop: 1.0, // 25.4mm — professional A4 report
      marginBottom: 1.0,
      marginLeft: 1.0,
      marginRight: 1.0,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="width: 100%; font-size: 9px; color: #999; text-align: center; padding: 0 25.4mm;">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    });
    const pdfBuffer = Buffer.from(data, "base64");

    return { buffer: pdfBuffer, title: doc.title };
  } finally {
    await page.close();
    browser.disconnect();
  }
}
