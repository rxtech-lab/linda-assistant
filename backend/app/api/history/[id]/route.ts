import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  taskHistory,
  tasks,
  historyEmails,
  historyWebhooks,
  emailInbox,
  webhookInbox,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectTaskHistoryDetailSchema, idParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId getHistoryDetail
 * @pathParams idParamSchema
 * @response selectTaskHistoryDetailSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const [entry] = await db
    .select({
      id: taskHistory.id,
      taskId: taskHistory.taskId,
      chatSessionId: taskHistory.chatSessionId,
      assigneeId: taskHistory.assigneeId,
      summary: taskHistory.summary,
      toolCalls: taskHistory.toolCalls,
      toolCallDetails: taskHistory.toolCallDetails,
      status: taskHistory.status,
      source: taskHistory.source,
      durationSecs: taskHistory.durationSecs,
      createdAt: taskHistory.createdAt,
      taskTitle: tasks.title,
    })
    .from(taskHistory)
    .innerJoin(tasks, eq(taskHistory.taskId, tasks.id))
    .where(and(eq(taskHistory.id, id), eq(taskHistory.userId, auth.userId)));

  if (!entry) return errorJson("History entry not found", 404);

  const [linkedEmails, linkedWebhooks] = await Promise.all([
    db
      .select({
        id: emailInbox.id,
        fromEmail: emailInbox.fromEmail,
        fromName: emailInbox.fromName,
        subject: emailInbox.subject,
        receivedAt: emailInbox.receivedAt,
        isRead: emailInbox.isRead,
      })
      .from(historyEmails)
      .innerJoin(emailInbox, eq(historyEmails.emailId, emailInbox.id))
      .where(eq(historyEmails.historyId, id)),
    db
      .select({
        id: webhookInbox.id,
        source: webhookInbox.source,
        event: webhookInbox.event,
        summary: webhookInbox.summary,
        receivedAt: webhookInbox.receivedAt,
        isRead: webhookInbox.isRead,
      })
      .from(historyWebhooks)
      .innerJoin(webhookInbox, eq(historyWebhooks.webhookId, webhookInbox.id))
      .where(eq(historyWebhooks.historyId, id)),
  ]);

  return successJson({ ...entry, emails: linkedEmails, webhooks: linkedWebhooks });
}
