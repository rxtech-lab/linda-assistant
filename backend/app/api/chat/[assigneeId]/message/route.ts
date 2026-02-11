import crypto from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees, chatSessions } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { sendMessageSchema, queuedResponseSchema, assigneeIdParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { publishTask } from "@/lib/queue/producer";

/**
 * Send a message to an assignee's persistent chat.
 *
 * Auto-creates a chat session for this assignee+user pair on first use,
 * then reuses it for all future messages. Appends the user message to the
 * session's message history, sets status to "starting", and publishes a
 * task to the RabbitMQ `agent-tasks` queue. Returns immediately.
 *
 * To receive the agent's response, connect to the SSE stream:
 * `GET /api/chat/:assigneeId/stream`
 *
 * @openapi
 * @operationId sendChatMessage
 * @pathParams assigneeIdParamSchema
 * @body sendMessageSchema
 * @response queuedResponseSchema
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assigneeId: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { assigneeId } = await params;
  const body = await request.json();
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  // Verify assignee belongs to user
  const [assignee] = await db
    .select()
    .from(assignees)
    .where(and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)));

  if (!assignee) return errorJson("Assignee not found", 404);

  // Find or create persistent session for this assignee+user pair
  let [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.assigneeId, assigneeId), eq(chatSessions.userId, auth.userId)))
    .limit(1);

  if (!session) {
    const [created] = await db
      .insert(chatSessions)
      .values({
        userId: auth.userId,
        assigneeId,
      })
      .returning();
    session = created;
  }

  // Build user message parts
  const contentParts: unknown[] = [{ type: "text", text: parsed.data.content }];

  if (parsed.data.attachments) {
    for (const attachment of parsed.data.attachments) {
      if (attachment.type === "image") {
        contentParts.push({
          type: "image",
          image: attachment.url,
        });
      } else {
        contentParts.push({
          type: "file",
          data: attachment.url,
          mimeType: getMimeType(attachment.type),
        });
      }
    }
  }

  const userMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: contentParts,
  };

  const messages = (session.messages as unknown[]) || [];
  const updatedMessages = [...messages, userMessage];

  // Save message and update session
  await db
    .update(chatSessions)
    .set({
      messages: updatedMessages,
      status: "starting",
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(chatSessions.id, session.id));

  // Publish task to queue for worker processing
  await publishTask({
    sessionId: session.id,
    userId: auth.userId,
    type: "message",
    timestamp: Date.now(),
  });

  return successJson({ queued: true });
}

function getMimeType(type: string): string {
  switch (type) {
    case "pdf":
      return "application/pdf";
    case "audio":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}
