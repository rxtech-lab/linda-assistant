/**
 * Standalone script to test PDF generation via headless Chrome.
 * Usage: CHROME_URL=ws://localhost:9222 bun run scripts/test-pdf-generate.ts
 */
import puppeteer from "puppeteer";

const chromeUrl = process.env.CHROME_URL;
if (!chromeUrl) {
  console.error("CHROME_URL environment variable is required");
  process.exit(1);
}

const sampleHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>PDF Test</title></head>
<body>
  <h1>PDF Generation Test</h1>
  <p>This is a test document to verify PDF generation works correctly.</p>
  <p>中文测试 - Chinese font rendering test</p>
</body>
</html>`;

async function resolveBrowserEndpoint(chromeUrl: string): Promise<string> {
  const httpBase = chromeUrl.replace(/^ws:\/\//, "http://");
  const url = `${httpBase}/json/version`;

  // Retry up to 30 seconds — Chrome may still be starting
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      const info = JSON.parse(text) as { webSocketDebuggerUrl: string };
      // Replace the advertised host (127.0.0.1) with the configured host
      const chromeHost = new URL(httpBase).host;
      return info.webSocketDebuggerUrl.replace(
        /ws:\/\/[^/]+/,
        `ws://${chromeHost}`,
      );
    } catch {
      console.log(`Waiting for Chrome at ${url}... (attempt ${i + 1}/30)`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Chrome not reachable at ${httpBase} after 30s`);
}

async function main() {
  console.log(`Connecting to Chrome at ${chromeUrl}...`);

  const browserWSEndpoint = await resolveBrowserEndpoint(chromeUrl!);
  console.log(`Resolved WebSocket endpoint: ${browserWSEndpoint}`);

  const browser = await puppeteer.connect({ browserWSEndpoint });

  const page = await browser.newPage();
  try {
    await page.setContent(sampleHtml, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    // Verify PDF magic bytes: %PDF
    const header = Buffer.from(pdfBuffer).subarray(0, 4).toString("ascii");
    if (header !== "%PDF") {
      console.error(`Invalid PDF output. Header: ${header}`);
      process.exit(1);
    }

    console.log(`PDF generated successfully (${pdfBuffer.byteLength} bytes)`);
  } finally {
    await page.close();
    browser.disconnect();
  }
}

main().catch((err) => {
  console.error("PDF generation test failed:", err);
  process.exit(1);
});
