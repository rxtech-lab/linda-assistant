import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  sendMessage,
  consumeStream,
  getChatHistory,
  findToolResultParts,
} from "./chat.utils";
import { TOKEN_FILE, type AuthToken } from "./auth.utils";

const BASE_URL = "http://localhost:3000";

function loadToken(): AuthToken {
  const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as AuthToken;
  if (!data.access_token) throw new Error("No access_token in auth-token.json");
  return data;
}

function authHeaders(token: AuthToken): Record<string, string> {
  return {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
  };
}

const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-slide-export-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe("Slide Export & Document with Slides", () => {
  test.setTimeout(300_000);
  test.skip(!process.env.CI, "Skipped outside CI");

  test("exports slide deck to PDF and images, and document with slides to PDF", async ({
    assigneeId,
  }) => {
    const token = loadToken();
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "slide-export",
    });

    try {
      // Ask the agent to create slides
      await sendMessage(
        assigneeId,
        "Create a simple 2-slide presentation titled 'Quarterly Review' about Q1 sales results. " +
          "Use the create_slides tool. Do not use any other tools.",
      );
      await stream.waitForDone();

      // Extract deckId from the create_slides tool result
      const { messages } = await getChatHistory(assigneeId);
      const slideResults = findToolResultParts(messages, "create_slides");
      expect(slideResults.length).toBeGreaterThanOrEqual(1);

      const rawOutput = slideResults[0]!.output as
        | { deckId: string; title: string; pageCount: number }
        | { type: string; value: { deckId: string; title: string; pageCount: number } };
      // AI SDK v6 wraps auto-executed tool output as { type: "json", value: ... }
      const slideOutput =
        "value" in rawOutput && rawOutput.type === "json"
          ? rawOutput.value
          : (rawOutput as { deckId: string; title: string; pageCount: number });
      expect(slideOutput.deckId).toBeTruthy();
      expect(typeof slideOutput.deckId).toBe("string");
      console.log(`Slide deck created: ${slideOutput.deckId} (${slideOutput.pageCount} pages)`);

      const deckId = slideOutput.deckId;

      // --- Test 1: Export slide deck to PDF ---
      const pdfRes = await fetch(`${BASE_URL}/api/slide-decks/${deckId}/export?format=pdf`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      expect(pdfRes.status).toBe(200);
      expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
      expect(pdfRes.headers.get("content-disposition")).toContain("Quarterly Review.pdf");

      const pdfBuffer = await pdfRes.arrayBuffer();
      expect(pdfBuffer.byteLength).toBeGreaterThan(0);
      const pdfHeader = new TextDecoder().decode(new Uint8Array(pdfBuffer.slice(0, 5)));
      expect(pdfHeader).toBe("%PDF-");
      console.log(`Slide deck PDF exported: ${pdfBuffer.byteLength} bytes`);

      // --- Test 2: Export slide deck to PPTX ---
      const pptxRes = await fetch(`${BASE_URL}/api/slide-decks/${deckId}/export?format=pptx`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      expect(pptxRes.status).toBe(200);
      expect(pptxRes.headers.get("content-type")).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      expect(pptxRes.headers.get("content-disposition")).toContain("Quarterly Review.pptx");

      const pptxBuffer = await pptxRes.arrayBuffer();
      expect(pptxBuffer.byteLength).toBeGreaterThan(0);
      const pptxHeader = new TextDecoder().decode(new Uint8Array(pptxBuffer.slice(0, 2)));
      expect(pptxHeader).toBe("PK");
      console.log(`Slide deck PPTX exported: ${pptxBuffer.byteLength} bytes`);

      // --- Test 3: Export slide deck to images ---
      const imagesRes = await fetch(`${BASE_URL}/api/slide-decks/${deckId}/export?format=images`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      expect(imagesRes.status).toBe(200);

      // successJson spreads the array, so the response is { "0": {...}, "1": {...}, ... }
      const imagesBody = (await imagesRes.json()) as Record<
        string,
        { pageNumber: number; imageUrl: string }
      >;
      const imagePages = Object.values(imagesBody);
      expect(imagePages.length).toBeGreaterThanOrEqual(1);
      for (const page of imagePages) {
        expect(page.pageNumber).toBeGreaterThanOrEqual(1);
        expect(page.imageUrl).toBeTruthy();
        expect(typeof page.imageUrl).toBe("string");
      }
      console.log(`Slide deck images exported: ${imagePages.length} pages`);

      // --- Test 4: Create a document with {{slide:deckId}} and export to PDF ---
      // First find the chat session for this assignee
      const listSlidesRes = await fetch(`${BASE_URL}/api/chat/${assigneeId}/slides`, {
        headers: authHeaders(token),
      });
      expect(listSlidesRes.status).toBe(200);
      const slidesBody = (await listSlidesRes.json()) as {
        data: Array<{ id: string }>;
      };
      expect(slidesBody.data.length).toBeGreaterThanOrEqual(1);

      // Create a chat session for the document
      const sessionRes = await fetch(`${BASE_URL}/api/chat-sessions`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "Slide doc test session" }),
      });
      expect(sessionRes.status).toBe(201);
      const session = (await sessionRes.json()) as { id: string };

      // Create document with slide embed syntax
      const docContent =
        `# Quarterly Report\n\n` +
        `Here are the slides from our presentation:\n\n` +
        `{{slide:${deckId}}}\n\n` +
        `The slides above show our Q1 performance.`;

      const createDocRes = await fetch(`${BASE_URL}/api/documents`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          chatSessionId: session.id,
          title: "Quarterly Report with Slides",
          format: "markdown",
          content: docContent,
        }),
      });
      expect(createDocRes.status).toBe(201);
      const doc = (await createDocRes.json()) as { id: string };

      // Verify the document content contains the slide syntax
      const getDocRes = await fetch(`${BASE_URL}/api/documents/${doc.id}`, {
        headers: authHeaders(token),
      });
      expect(getDocRes.status).toBe(200);
      const docData = (await getDocRes.json()) as {
        id: string;
        content: string;
        format: string;
      };
      expect(docData.content).toContain(`{{slide:${deckId}}}`);
      expect(docData.format).toBe("markdown");
      console.log("Document with slide syntax verified");

      // Export document to PDF — slides should render as vertically stacked images
      const docPdfRes = await fetch(`${BASE_URL}/api/documents/${doc.id}/pdf`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      expect(docPdfRes.status).toBe(200);
      expect(docPdfRes.headers.get("content-type")).toBe("application/pdf");
      expect(docPdfRes.headers.get("content-disposition")).toContain(
        "Quarterly Report with Slides.pdf",
      );

      const docPdfBuffer = await docPdfRes.arrayBuffer();
      expect(docPdfBuffer.byteLength).toBeGreaterThan(0);
      const docPdfHeader = new TextDecoder().decode(new Uint8Array(docPdfBuffer.slice(0, 5)));
      expect(docPdfHeader).toBe("%PDF-");
      console.log(`Document PDF with slides exported: ${docPdfBuffer.byteLength} bytes`);

      // Clean up the chat session (documents cascade)
      await fetch(`${BASE_URL}/api/chat-sessions/${session.id}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
    } finally {
      stream.cancel();
    }
  });
});
