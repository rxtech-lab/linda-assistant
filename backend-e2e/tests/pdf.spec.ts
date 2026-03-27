import { test, expect } from "@playwright/test";
import fs from "node:fs";
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

async function createChatSession(token: AuthToken): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/chat-sessions`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ title: "PDF test session" }),
  });
  if (!res.ok) throw new Error(`Failed to create chat session (${res.status})`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function createDocument(
  token: AuthToken,
  chatSessionId: string,
  doc: { title: string; format: string; content: string },
): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/documents`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ chatSessionId, ...doc }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create document (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function deleteChatSession(token: AuthToken, id: string): Promise<void> {
  await fetch(`${BASE_URL}/api/chat-sessions/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

test.describe("PDF generation", () => {
  test.skip(!process.env.CI, "Skipped outside CI");
  let token: AuthToken;
  let chatSessionId: string;

  test.beforeAll(async () => {
    token = loadToken();
    chatSessionId = await createChatSession(token);
  });

  test.afterAll(async () => {
    if (chatSessionId) {
      await deleteChatSession(token, chatSessionId);
    }
  });

  test("generates PDF from markdown document", async () => {
    const docId = await createDocument(token, chatSessionId, {
      title: "Test Markdown Document",
      format: "markdown",
      content:
        "# Hello World\n\nThis is a **test** document.\n\n- Item 1\n- Item 2\n",
    });

    const res = await fetch(`${BASE_URL}/api/documents/${docId}/pdf`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(
      "Test Markdown Document.pdf",
    );

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    // Verify it starts with PDF magic bytes
    const header = new Uint8Array(buffer.slice(0, 5));
    const pdfMagic = new TextDecoder().decode(header);
    expect(pdfMagic).toBe("%PDF-");
  });

  test("generates PDF from HTML document", async () => {
    const docId = await createDocument(token, chatSessionId, {
      title: "Test HTML Document",
      format: "html",
      content:
        "<h2>HTML Content</h2><p>This is an <strong>HTML</strong> document.</p>",
    });

    const res = await fetch(`${BASE_URL}/api/documents/${docId}/pdf`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");

    const buffer = await res.arrayBuffer();
    const header = new Uint8Array(buffer.slice(0, 5));
    const pdfMagic = new TextDecoder().decode(header);
    expect(pdfMagic).toBe("%PDF-");
  });

  test("generates PDF from document with CJK characters", async () => {
    const docId = await createDocument(token, chatSessionId, {
      title: "中文测试文档",
      format: "markdown",
      content:
        "# 你好世界\n\n这是一个包含中文的测试文档。\n\n日本語テスト。한국어 테스트.",
    });

    const res = await fetch(`${BASE_URL}/api/documents/${docId}/pdf`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    const header = new Uint8Array(buffer.slice(0, 5));
    const pdfMagic = new TextDecoder().decode(header);
    expect(pdfMagic).toBe("%PDF-");
  });

  test("returns 404 for non-existent document", async () => {
    const res = await fetch(`${BASE_URL}/api/documents/nonexistent-id/pdf`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });

    expect(res.status).toBe(404);
  });
});
