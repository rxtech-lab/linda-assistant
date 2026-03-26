import type { ModelMessage } from "ai";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { insertMessages } from "@/lib/db/messages";
import { assignees, chatSessions } from "@/lib/db/schema";
import { sendPushNotification } from "@/lib/push";
import { publishTask } from "@/lib/queue/producer";
import { stripMarkdown } from "@/lib/utils/markdown";

type Assignee = { userId: string; id: string };

/** Create a new chat session for the assignee, insert a user message, and queue the agent to process it. */
export async function createAssigneeFollowUp(
  textContent: string,
  assignee: Assignee,
  title?: string,
  taskId?: string,
  accessToken?: string,
) {
  const [session] = await db
    .insert(chatSessions)
    .values({
      userId: assignee.userId,
      assigneeId: assignee.id,
      taskId: taskId ?? null,
      title: title ?? textContent.slice(0, 80),
      status: "starting",
      accessToken: accessToken ?? null,
    })
    .returning();

  const userMessage = {
    id: crypto.randomUUID(),
    role: "user" as const,
    content: [{ type: "text", text: textContent }],
  } as ModelMessage;

  await insertMessages(session.id, [userMessage]);

  await publishTask({
    sessionId: session.id,
    userId: assignee.userId,
    type: "message",
    timestamp: Date.now(),
  });

  return session;
}

/** Look up the assignee name for the session and send a push notification with the response text. */
export async function notifySessionResponse(
  sessionId: string,
  userId: string,
  responseText: string,
) {
  const [session] = await db
    .select({ assigneeId: chatSessions.assigneeId })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId));

  let title = "New message";
  if (session?.assigneeId) {
    const [assignee] = await db
      .select({ name: assignees.name })
      .from(assignees)
      .where(eq(assignees.id, session.assigneeId));
    if (assignee) title = assignee.name;
  }

  const plainText = stripMarkdown(responseText);
  const body =
    plainText.length > 200
      ? `${plainText.substring(0, 200)}...`
      : plainText || `Agent responded to your message`;

  await sendPushNotification(userId, {
    title,
    body,
    data: { sessionId, type: "assistant_message" },
  });
}
