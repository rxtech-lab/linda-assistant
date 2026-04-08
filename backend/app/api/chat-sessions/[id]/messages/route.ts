import crypto from "crypto";
import type { ModelMessage } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import {
  sendMessageSchema,
  queuedResponseSchema,
  chatMessagesResponseSchema,
  idParamSchema,
} from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { publishTask, publishEvent } from "@/lib/queue/producer";
import { insertMessages, getPagedMessages } from "@/lib/db/messages";
import { processUserAttachments } from "@/lib/ai/user-attachments";
import { assignees } from "@/lib/db/schema";
import { getLanguageModel } from "@/lib/ai/models";

/**
 * Get paginated messages from a chat session.
 *
 * Returns the last `limit` messages (default 100, max 100) in chronological order.
 * Use the `before` query param with a message ID to load older messages.
 *
 * @openapi
 * @operationId getSessionMessages
 * @pathParams idParamSchema
 * @response chatMessagesResponseSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  // Verify session belongs to user
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId)));

  if (!session) return errorJson("Chat session not found", 404);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 100);
  const before = url.searchParams.get("before") || undefined;

  try {
    const result = await getPagedMessages(session.id, limit, before);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "Cursor not found") {
      return errorJson("Cursor not found", 400);
    }
    throw e;
  }
}

/**
 * Send a user message to a chat session.
 *
 * Appends the message to the session's message history in the database,
 * sets the session status to "starting", and publishes a task to the
 * RabbitMQ `agent-tasks` queue. A separate worker process picks up the
 * task and runs the AI agent. Returns immediately with `{ queued: true }`.
 *
 * To receive the agent's response, connect to the SSE stream endpoint:
 * `GET /api/chat-sessions/[id]/stream`
 *
 * @openapi
 * @operationId sendMessage
 * @pathParams idParamSchema
 * @body sendMessageSchema
 * @response queuedResponseSchema
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  // Verify session belongs to user
  const [session] = await db
    .select({
      id: chatSessions.id,
      assigneeId: chatSessions.assigneeId,
    })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId)));

  if (!session) return errorJson("Chat session not found", 404);

  // Reject image attachments when the model doesn't support images
  if (parsed.data.attachments?.some((a) => a.type === "image") && session.assigneeId) {
    const [assignee] = await db
      .select({ model: assignees.model })
      .from(assignees)
      .where(eq(assignees.id, session.assigneeId));
    if (assignee?.model) {
      const model = getLanguageModel(assignee.model);
      if (model && !model.supported_features.includes("image")) {
        return errorJson("This model does not support image attachments", 422);
      }
    }
  }

  // Build user message parts
  const contentParts: unknown[] = [{ type: "text", text: parsed.data.content }];
  let fileSystemMessage: { role: "system"; content: string } | null = null;

  if (parsed.data.attachments && parsed.data.attachments.length > 0) {
    const { userContentParts, systemMessage } = await processUserAttachments(
      parsed.data.attachments,
      auth.userId,
      id,
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
  await insertMessages(id, messagesToInsert);
  await db
    .update(chatSessions)
    .set({
      status: "starting",
      ...(parsed.data.deviceToken ? { deviceToken: parsed.data.deviceToken } : {}),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(chatSessions.id, id));

  // Broadcast user message to all SSE subscribers (multi-device sync)
  await publishEvent({
    sessionId: id,
    event: "user-message",
    data: { id: messageId, content: parsed.data.content },
    timestamp: Date.now(),
  });

  // Publish task to queue for worker processing
  await publishTask({
    sessionId: id,
    userId: auth.userId,
    type: "message",
    timestamp: Date.now(),
  });

  return successJson({ queued: true, messageId });
}
