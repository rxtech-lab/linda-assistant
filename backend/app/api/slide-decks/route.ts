import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { slideDecks } from "@/lib/db/schema";
import { authenticate } from "@/lib/auth/middleware";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * POST /api/slide-decks
 * Create a new slide deck.
 *
 * @openapi
 * /api/slide-decks:
 *   post:
 *     summary: Create a new slide deck
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chatSessionId, title]
 *             properties:
 *               chatSessionId: { type: string }
 *               title: { type: string }
 *               theme: { type: object }
 *     responses:
 *       201: { description: Slide deck created }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  let body: { chatSessionId?: string; title?: string; theme?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  if (!body.chatSessionId || !body.title) {
    return errorJson("chatSessionId and title are required", 400);
  }

  const [deck] = await db
    .insert(slideDecks)
    .values({
      userId: auth.userId,
      chatSessionId: body.chatSessionId,
      title: body.title,
      theme: body.theme,
    })
    .returning();

  return successJson(deck, 201);
}
