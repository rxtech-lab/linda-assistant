import crypto from "crypto";
import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { confirmations, chatSessions, assignees } from "@/lib/db/schema";
import type { ToolPermission } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { sendPushNotification } from "@/lib/push";
import { syncTaskStatus } from "@/lib/utils/task-status-sync";
import { publishTask, publishEvent } from "@/lib/queue/producer";
import { annotateToolCallConfirmation } from "./agent";

interface CreateConfirmationParams {
  userId: string;
  chatSessionId: string;
  toolCallId: string;
  toolName: string;
  approvalId: string;
  parameters: Record<string, unknown>;
}

export async function createConfirmation(params: CreateConfirmationParams) {
  const [confirmation] = await db.insert(confirmations).values(params).returning();

  // Send push notification
  await sendPushNotification(params.userId, {
    title: "Action Requires Confirmation",
    body: `Linda wants to ${formatToolName(params.toolName)}. Please review.`,
    data: {
      type: "confirmation",
      confirmationId: confirmation.id,
      chatSessionId: params.chatSessionId,
    },
  }).catch((err) => {
    console.error("Failed to send push notification:", err);
  });

  return confirmation;
}

export async function resolveConfirmation(
  confirmationId: string,
  action: "confirm" | "reject",
  options?: { alwaysAllow?: boolean },
) {
  const [confirmation] = await db
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, confirmationId));

  if (!confirmation) throw new Error("Confirmation not found");
  if (confirmation.status !== "pending") throw new Error("Confirmation already resolved");

  // Update confirmation status
  await db
    .update(confirmations)
    .set({
      status: action === "confirm" ? "confirmed" : "rejected",
      resolvedAt: sql`(datetime('now'))`,
    })
    .where(eq(confirmations.id, confirmationId));

  // Load the chat session
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, confirmation.chatSessionId));

  if (!session) throw new Error("Chat session not found");

  const messages = (session.messages as ModelMessage[]) || [];
  const resolvedStatus = action === "confirm" ? "confirmed" : "rejected";

  // Update the embedded confirmation status in the stored tool-call content part
  annotateToolCallConfirmation(messages, confirmation.toolCallId, confirmation.id, resolvedStatus);

  // Add SDK tool-approval-response so the agent can resume with the SDK's approval flow
  const approvalResponse = {
    id: crypto.randomUUID(),
    role: "tool" as const,
    content: [
      {
        type: "tool-approval-response" as const,
        approvalId: confirmation.approvalId,
        approved: action === "confirm",
        ...(action === "reject" ? { reason: "User rejected this action" } : {}),
      },
    ],
  };

  const updatedMessages = [...messages, approvalResponse];

  // Both confirm and reject → set in_progress, resume agent
  // The SDK will execute the tool (if approved) or emit tool-output-denied (if rejected)
  await db
    .update(chatSessions)
    .set({
      messages: updatedMessages as unknown[],
      status: "in_progress",
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(chatSessions.id, confirmation.chatSessionId));

  // Emit status event so the SSE stream knows we're resuming
  await publishEvent({
    sessionId: confirmation.chatSessionId,
    event: "status",
    data: { status: "in_progress" },
    timestamp: Date.now(),
  });

  // Signal agent to resume via queue
  await publishTask({
    sessionId: confirmation.chatSessionId,
    userId: confirmation.userId,
    type: "confirmation_resolved",
    timestamp: Date.now(),
  });

  // Handle alwaysAllow — update assignee's toolPermissions to auto-confirm this tool
  if (action === "confirm" && options?.alwaysAllow && session.assigneeId) {
    const [assignee] = await db
      .select({ toolPermissions: assignees.toolPermissions })
      .from(assignees)
      .where(eq(assignees.id, session.assigneeId));

    const perms: ToolPermission[] = (assignee?.toolPermissions as ToolPermission[]) ?? [];
    const idx = perms.findIndex((tp) => tp.toolName === confirmation.toolName);
    if (idx >= 0) {
      perms[idx].permission = "auto-confirm";
    } else {
      perms.push({ toolName: confirmation.toolName, permission: "auto-confirm" });
    }

    await db
      .update(assignees)
      .set({ toolPermissions: perms, updatedAt: sql`(datetime('now'))` })
      .where(eq(assignees.id, session.assigneeId));
  }

  // Sync task status if applicable
  if (session.taskId) {
    await syncTaskStatus(session.taskId);
  }

  return { action, confirmationId };
}

function formatToolName(name: string): string {
  return name.replace(/_/g, " ");
}
