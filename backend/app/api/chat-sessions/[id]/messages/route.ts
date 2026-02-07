import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { sendMessageSchema, queuedResponseSchema, idParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { setAgentTrigger } from "@/lib/streaming/manager";

/**
 * @openapi
 * @operationId sendMessage
 * @pathParams idParamSchema
 * @body sendMessageSchema
 * @response queuedResponseSchema
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  // Verify session belongs to user
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId))
    );

  if (!session) return errorJson("Chat session not found", 404);

  // Build user message parts
  const contentParts: unknown[] = [
    { type: "text", text: parsed.data.content },
  ];

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
    .where(eq(chatSessions.id, id));

  // Trigger agent processing
  await setAgentTrigger(id);

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

