import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { ensureOnboarded } from "./onboard.utils";
import { TOKEN_FILE, type AuthToken } from "./auth.utils";

const BASE_URL = "http://localhost:3000";

/** A minimal Konva Stage scene with Chinese text on a solid background. */
const CJK_SCENE_DATA = {
  attrs: { width: 800, height: 400 },
  className: "Stage",
  children: [
    {
      attrs: {},
      className: "Layer",
      children: [
        {
          attrs: {
            x: 0,
            y: 0,
            width: 800,
            height: 400,
            fill: "#1D1D1F",
          },
          className: "Rect",
        },
        {
          attrs: {
            x: 40,
            y: 40,
            width: 720,
            text: "中文渲染测试",
            fontSize: 72,
            fontFamily: "Noto Sans CJK SC, sans-serif",
            fontStyle: "bold",
            fill: "#FFFFFF",
            align: "center",
          },
          className: "Text",
        },
        {
          attrs: {
            x: 40,
            y: 160,
            width: 720,
            text: "日本語テスト・한국어 테스트",
            fontSize: 48,
            fontFamily: "Noto Sans CJK SC, sans-serif",
            fill: "#4A90D9",
            align: "center",
          },
          className: "Text",
        },
        {
          attrs: {
            x: 40,
            y: 260,
            width: 720,
            text: "CJK Font Rendering — 字体渲染验证",
            fontSize: 36,
            fontFamily: "Noto Sans CJK SC, sans-serif",
            fill: "#86868B",
            align: "center",
          },
          className: "Text",
        },
      ],
    },
  ],
};

function loadToken(): AuthToken {
  const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as AuthToken;
  if (!data.access_token)
    throw new Error("No access_token in auth-token.json");
  return data;
}

function authHeaders(token: AuthToken): Record<string, string> {
  return {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
  };
}

/** Create a deck + page with the CJK scene and return the rendered PNG buffer. */
async function renderCJKSlide(token: AuthToken): Promise<{
  png: Buffer;
  deckId: string;
  pageId: string;
  sessionId: string;
}> {
  const headers = authHeaders(token);

  // Create a chat session
  const sessionRes = await fetch(`${BASE_URL}/api/chat-sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "CJK render test" }),
  });
  if (!sessionRes.ok)
    throw new Error(`Create session failed (${sessionRes.status})`);
  const session = (await sessionRes.json()) as { id: string };

  // Create a slide deck
  const deckRes = await fetch(`${BASE_URL}/api/slide-decks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      chatSessionId: session.id,
      title: "CJK Render Test",
    }),
  });
  if (!deckRes.ok)
    throw new Error(`Create deck failed (${deckRes.status})`);
  const deck = (await deckRes.json()) as { id: string };

  // Add a page with CJK scene data (renders + uploads automatically)
  const pageRes = await fetch(`${BASE_URL}/api/slide-decks/${deck.id}/pages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sceneData: CJK_SCENE_DATA }),
  });
  if (!pageRes.ok)
    throw new Error(
      `Add page failed (${pageRes.status}): ${await pageRes.text()}`,
    );
  const page = (await pageRes.json()) as { id: string };

  // Render the page to PNG
  const renderRes = await fetch(
    `${BASE_URL}/api/slide-decks/${deck.id}/pages/${page.id}/render`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}` },
    },
  );
  if (!renderRes.ok) throw new Error(`Render failed (${renderRes.status})`);

  const arrayBuffer = await renderRes.arrayBuffer();
  return {
    png: Buffer.from(arrayBuffer),
    deckId: deck.id,
    pageId: page.id,
    sessionId: session.id,
  };
}

/**
 * CJK font rendering test.
 *
 * First run (locally): Playwright creates the reference snapshot automatically.
 * Subsequent runs (CI): Compares against the committed snapshot.
 *
 * To update the snapshot after a font change:
 *   cd backend-e2e && bunx playwright test slide-cjk-render --update-snapshots
 */
test.describe("Slide CJK Render", () => {
  test("rendered CJK slide matches snapshot", async () => {
    await ensureOnboarded();
    const token = loadToken();
    const { png, deckId, sessionId } = await renderCJKSlide(token);

    expect(png).toMatchSnapshot("slide-cjk-render.png", {
      maxDiffPixelRatio: 0.01,
    });

    // Cleanup
    const headers = authHeaders(token);
    await fetch(`${BASE_URL}/api/slide-decks/${deckId}`, {
      method: "DELETE",
      headers,
    });
    await fetch(`${BASE_URL}/api/chat-sessions/${sessionId}`, {
      method: "DELETE",
      headers,
    });
  });
});
