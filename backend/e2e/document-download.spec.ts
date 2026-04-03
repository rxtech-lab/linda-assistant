import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import path from "path";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

test.describe("Document Download", () => {
  const userId = "e2e-test-user";
  let assigneeId: string;
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    // Create an assignee via API
    const res = await request.post("/api/assignees", {
      data: { name: "Doc Download Test", email: "doc-download@example.com" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeId = body.id;

    // Create a chat session directly in DB
    sessionId = nanoid();
    const client = createClient({ url: `file:${dbPath}` });
    await client.execute({
      sql: `INSERT INTO chat_sessions (id, user_id, assignee_id, status)
            VALUES (?, ?, ?, 'stopped')`,
      args: [sessionId, userId, assigneeId],
    });
    client.close();
  });

  test("download markdown replaces {{slide:id}} with image references", async ({
    request,
  }) => {
    const client = createClient({ url: `file:${dbPath}` });

    // Create a slide deck with pages
    const deckId = nanoid();
    await client.execute({
      sql: `INSERT INTO slide_decks (id, user_id, chat_session_id, title) VALUES (?, ?, ?, ?)`,
      args: [deckId, userId, sessionId, "Test Slides"],
    });

    await client.execute({
      sql: `INSERT INTO slide_pages (id, deck_id, page_number, image_url) VALUES (?, ?, ?, ?)`,
      args: [nanoid(), deckId, 1, "https://example.com/slide1.png"],
    });
    await client.execute({
      sql: `INSERT INTO slide_pages (id, deck_id, page_number, image_url) VALUES (?, ?, ?, ?)`,
      args: [nanoid(), deckId, 2, "https://example.com/slide2.png"],
    });

    // Create a document with {{slide:id}} token
    const docId = nanoid();
    const content = `# My Document\n\n{{slide:${deckId}}}\n\n## Conclusion\n\nEnd of doc.`;
    await client.execute({
      sql: `INSERT INTO documents (id, user_id, chat_session_id, title, format, content)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [docId, userId, sessionId, "Test Document", "markdown", content],
    });
    client.close();

    // Download the processed document
    const res = await request.get(`/api/documents/${docId}/download`);
    expect(res.ok()).toBeTruthy();

    const text = await res.text();

    // Should NOT contain raw {{slide:...}} token
    expect(text).not.toContain("{{slide:");

    // Should contain markdown image references for both slides
    expect(text).toContain("![Slide 1](https://example.com/slide1.png)");
    expect(text).toContain("![Slide 2](https://example.com/slide2.png)");

    // Should preserve surrounding content
    expect(text).toContain("# My Document");
    expect(text).toContain("## Conclusion");

    // Verify content-disposition header
    const disposition = res.headers()["content-disposition"];
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(".md");
  });

  test("download HTML document replaces {{slide:id}} with img tags", async ({
    request,
  }) => {
    const client = createClient({ url: `file:${dbPath}` });

    const deckId = nanoid();
    await client.execute({
      sql: `INSERT INTO slide_decks (id, user_id, chat_session_id, title) VALUES (?, ?, ?, ?)`,
      args: [deckId, userId, sessionId, "HTML Test Slides"],
    });
    await client.execute({
      sql: `INSERT INTO slide_pages (id, deck_id, page_number, image_url) VALUES (?, ?, ?, ?)`,
      args: [nanoid(), deckId, 1, "https://example.com/html-slide1.png"],
    });

    const docId = nanoid();
    const content = `<h1>Report</h1>\n{{slide:${deckId}}}\n<p>Done.</p>`;
    await client.execute({
      sql: `INSERT INTO documents (id, user_id, chat_session_id, title, format, content)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [docId, userId, sessionId, "HTML Document", "html", content],
    });
    client.close();

    const res = await request.get(`/api/documents/${docId}/download`);
    expect(res.ok()).toBeTruthy();

    const text = await res.text();
    expect(text).not.toContain("{{slide:");
    expect(text).toContain("<img");
    expect(text).toContain("https://example.com/html-slide1.png");

    const disposition = res.headers()["content-disposition"];
    expect(disposition).toContain(".html");
  });

  test("download document without slides returns content unchanged", async ({
    request,
  }) => {
    const client = createClient({ url: `file:${dbPath}` });

    const docId = nanoid();
    const content = "# Simple Document\n\nNo slides here.";
    await client.execute({
      sql: `INSERT INTO documents (id, user_id, chat_session_id, title, format, content)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [docId, userId, sessionId, "Simple Doc", "markdown", content],
    });
    client.close();

    const res = await request.get(`/api/documents/${docId}/download`);
    expect(res.ok()).toBeTruthy();

    const text = await res.text();
    expect(text).toBe(content);
  });
});
