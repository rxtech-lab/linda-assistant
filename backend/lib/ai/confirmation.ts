import crypto from "crypto";
import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { confirmations, chatSessions, assignees } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { sendPushNotification } from "@/lib/push";
import { resend } from "@/lib/resend";
import { syncTaskStatus } from "@/lib/utils/task-status-sync";
import { publishTask, publishEvent } from "@/lib/queue/producer";
import { annotateToolCallConfirmation } from "./agent";

interface CreateConfirmationParams {
  userId: string;
  chatSessionId: string;
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
}

export async function createConfirmation(params: CreateConfirmationParams) {
  const [confirmation] = await db
    .insert(confirmations)
    .values(params)
    .returning();

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
  action: "confirm" | "reject"
) {
  const [confirmation] = await db
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, confirmationId));

  if (!confirmation) throw new Error("Confirmation not found");
  if (confirmation.status !== "pending")
    throw new Error("Confirmation already resolved");

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
  annotateToolCallConfirmation(
    messages,
    confirmation.toolCallId,
    confirmation.id,
    resolvedStatus,
  );

  if (action === "confirm") {
    // Execute the confirmed tool
    const toolResult = await executeConfirmedTool(
      confirmation.toolName,
      confirmation.parameters as Record<string, unknown>,
      confirmation.userId,
      confirmation.chatSessionId
    );

    // Add tool result to messages (output must match AI SDK v6 ModelMessage format)
    const toolResultMessage = {
      id: crypto.randomUUID(),
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: confirmation.toolCallId,
          toolName: confirmation.toolName,
          output: { type: "json" as const, value: toolResult },
          approveStatus: "confirmed" as const,
        },
      ],
    };

    const updatedMessages = [...messages, toolResultMessage];

    // Update session with tool result and set to in_progress for agent to continue
    await db
      .update(chatSessions)
      .set({
        messages: updatedMessages as unknown[],
        status: "in_progress",
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(chatSessions.id, confirmation.chatSessionId));

    // Emit immediate status event so the SSE stream knows we're resuming
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
  } else {
    // Rejection - add rejection message and stop session
    const rejectionMessage = {
      id: crypto.randomUUID(),
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: confirmation.toolCallId,
          toolName: confirmation.toolName,
          output: {
            type: "json" as const,
            value: {
              error: "User rejected this action",
              rejected: true,
            },
          },
          approveStatus: "rejected" as const,
        },
      ],
    };

    const updatedMessages = [...messages, rejectionMessage];

    await db
      .update(chatSessions)
      .set({
        messages: updatedMessages as unknown[],
        status: "stopped",
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(chatSessions.id, confirmation.chatSessionId));

    // Publish rejection events to SSE stream
    const now = Date.now();
    await publishEvent({
      sessionId: confirmation.chatSessionId,
      event: "tool-result",
      data: {
        toolCallId: confirmation.toolCallId,
        toolName: confirmation.toolName,
        output: { error: "User rejected this action", rejected: true },
        approveStatus: "rejected",
      },
      timestamp: now,
    });
    await publishEvent({
      sessionId: confirmation.chatSessionId,
      event: "status",
      data: { status: "stopped" },
      timestamp: now,
    });
    await publishEvent({
      sessionId: confirmation.chatSessionId,
      event: "done",
      data: {},
      timestamp: now,
    });
  }

  // Sync task status if applicable
  if (session.taskId) {
    await syncTaskStatus(session.taskId);
  }

  return { action, confirmationId };
}

async function executeConfirmedTool(
  toolName: string,
  parameters: Record<string, unknown>,
  userId: string,
  chatSessionId: string
) {
  switch (toolName) {
    case "send_email": {
      const { to, subject, body } = parameters as {
        to: string;
        subject: string;
        body: string;
      };

      // Look up the assignee's email from the chat session's assignee configuration
      let fromAddress = `linda@${process.env.RESEND_DOMAIN || "assistant.rxlab.io"}`;
      const [session] = await db
        .select({ assigneeId: chatSessions.assigneeId })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));
      if (session?.assigneeId) {
        const [assignee] = await db
          .select({ email: assignees.email })
          .from(assignees)
          .where(eq(assignees.id, session.assigneeId));
        if (assignee?.email) {
          fromAddress = assignee.email;
        }
      }

      const result = await resend.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html: body,
      });

      return { sent: true, emailId: result.data?.id };
    }
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function formatToolName(name: string): string {
  return name.replace(/_/g, " ");
}
