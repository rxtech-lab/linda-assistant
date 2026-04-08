import crypto from "crypto";
import type { ModelMessage } from "ai";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { assignees, chatSessions } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { sendMessageSchema, queuedResponseSchema, assigneeIdParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { getLanguageModel } from "@/lib/ai/models";
import { publishTask, publishEvent } from "@/lib/queue/producer";
import { insertMessages } from "@/lib/db/messages";
import { processUserAttachments } from "@/lib/ai/user-attachments";

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

  // Reject image attachments when the model doesn't support images
  if (parsed.data.attachments?.some((a) => a.type === "image")) {
    const model = getLanguageModel(assignee.model ?? "");
    if (model && !model.supported_features.includes("image")) {
      return errorJson("This model does not support image attachments", 422);
    }
  }

  // Find or create persistent session for this assignee+user pair
  let [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.assigneeId, assigneeId), eq(chatSessions.userId, auth.userId)))
    .limit(1);

  if (!session) {
    const [created] = await db
      .insert(chatSessions)
      .values({
        userId: auth.userId,
        assigneeId,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
      })
      .returning({ id: chatSessions.id });
    session = created;
  } else {
    // Update tokens on each message in case they have been refreshed
    await db
      .update(chatSessions)
      .set({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
      })
      .where(eq(chatSessions.id, session.id));
  }

  // Build user message parts
  const contentParts: unknown[] = [{ type: "text", text: parsed.data.content }];
  let fileSystemMessage: { role: "system"; content: string } | null = null;

  if (parsed.data.attachments && parsed.data.attachments.length > 0) {
    const { userContentParts, systemMessage } = await processUserAttachments(
      parsed.data.attachments,
      auth.userId,
      session.id,
    );
    contentParts.push(...userContentParts);
    fileSystemMessage = systemMessage;
  }

  const messageId = crypto.randomUUID();
  const userMessage = {
    id: messageId,
    role: "user" as const,
    content: contentParts,
  } as ModelMessage;

  // Insert user message, then optional system message with file instructions
  const messagesToInsert: ModelMessage[] = [userMessage];
  if (fileSystemMessage) {
    messagesToInsert.push({
      id: crypto.randomUUID(),
      ...fileSystemMessage,
    } as unknown as ModelMessage);
  }
  await insertMessages(session.id, messagesToInsert);
  await db
    .update(chatSessions)
    .set({
      status: "starting",
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      ...(parsed.data.deviceToken ? { deviceToken: parsed.data.deviceToken } : {}),
      ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(chatSessions.id, session.id));

  // Broadcast user message to all SSE subscribers (multi-device sync)
  await publishEvent({
    sessionId: session.id,
    event: "user-message",
    data: { id: messageId, content: parsed.data.content },
    timestamp: Date.now(),
  });

  // Publish task to queue for worker processing
  await publishTask({
    sessionId: session.id,
    userId: auth.userId,
    type: "message",
    timestamp: Date.now(),
  });

  return successJson({ queued: true, messageId });
}
