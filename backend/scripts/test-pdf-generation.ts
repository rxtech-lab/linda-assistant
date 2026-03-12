/**
 * Smoke test for PDF generation inside Docker.
 *
 * Launches Puppeteer, renders a minimal HTML page to PDF, and verifies the
 * output starts with the PDF magic bytes ("%PDF-").
 *
 * Usage:
 *   bun scripts/test-pdf-generation.ts
 *
 * Exit codes:
 *   0 – success
 *   1 – failure (details printed to stderr)
 */
import puppeteer from "puppeteer";

async function main() {
  console.log("Launching browser…");
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setContent(
      "<html><body><h1>PDF Test</h1><p>Hello from Puppeteer!</p></body></html>",
      { waitUntil: "networkidle0" },
    );

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    if (pdfBuffer.length === 0) {
      throw new Error("PDF buffer is empty");
    }

    const header = Buffer.from(pdfBuffer).subarray(0, 5).toString("ascii");
    if (header !== "%PDF-") {
      throw new Error(`Invalid PDF header: ${header}`);
    }

    console.log(`PDF generated successfully (${pdfBuffer.length} bytes)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("PDF generation test failed:", err);
  process.exit(1);
});
