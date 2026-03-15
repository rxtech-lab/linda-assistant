import crypto from "crypto";
import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { confirmations, chatSessions, assignees } from "@/lib/db/schema";
import type { ToolPermission } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { sendPushNotification } from "@/lib/push";
import { syncTaskStatus } from "@/lib/utils/task-status-sync";
import { publishTask, publishEvent } from "@/lib/queue/producer";
import { annotateToolCallConfirmation } from "./agent";
import { getActiveSessionMessages, insertMessages, updateMessageContent } from "@/lib/db/messages";

interface CreateConfirmationParams {
  userId: string;
  chatSessionId: string;
  toolCallId: string;
  toolName: string;
  approvalId: string;
  parameters: Record<string, unknown>;
  skipNotification?: boolean;
}

export async function createConfirmation(params: CreateConfirmationParams) {
  const [confirmation] = await db.insert(confirmations).values(params).returning();

  if (!params.skipNotification) {
    // Send push notification (single confirmation path)
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
  }

  return confirmation;
}

export async function sendConfirmationGroupNotification(
  userId: string,
  chatSessionId: string,
  items: Array<{ confirmationId: string; toolName: string }>,
) {
  if (items.length === 0) return;

  const isSingle = items.length === 1;
  const title = isSingle ? "Action Requires Confirmation" : "Actions Require Confirmation";

  const toolNames = items.map((i) => formatToolName(i.toolName));
  let body: string;
  if (toolNames.length === 1) {
    body = `Linda wants to ${toolNames[0]}. Please review.`;
  } else if (toolNames.length === 2) {
    body = `Linda wants to ${toolNames[0]} and ${toolNames[1]}. Please review.`;
  } else {
    const last = toolNames.pop()!;
    body = `Linda wants to ${toolNames.join(", ")}, and ${last}. Please review.`;
  }

  await sendPushNotification(userId, {
    title,
    body,
    data: {
      type: "confirmation",
      chatSessionId,
      ...(isSingle ? { confirmationId: items[0].confirmationId } : {}),
    },
  }).catch((err) => {
    console.error("Failed to send grouped push notification:", err);
  });
}

export async function resolveConfirmation(
  confirmationId: string,
  action: "confirm" | "reject",
  options?: { alwaysAllow?: boolean },
) {
  console.log(`[resolveConfirmation] START id=${confirmationId} action=${action}`);

  const [confirmation] = await db
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, confirmationId));

  if (!confirmation) throw new Error("Confirmation not found");
  if (confirmation.status !== "pending") throw new Error("Confirmation already resolved");

  console.log(
    `[resolveConfirmation] Found confirmation: session=${confirmation.chatSessionId} toolCallId=${confirmation.toolCallId} toolName=${confirmation.toolName}`,
  );

  // Update confirmation status
  await db
    .update(confirmations)
    .set({
      status: action === "confirm" ? "confirmed" : "rejected",
      resolvedAt: sql`(datetime('now'))`,
    })
    .where(eq(confirmations.id, confirmationId));

  console.log(
    `[resolveConfirmation] Updated confirmation status to ${action === "confirm" ? "confirmed" : "rejected"}`,
  );

  // Load the chat session (only need metadata, not messages)
  const [session] = await db
    .select({
      id: chatSessions.id,
      assigneeId: chatSessions.assigneeId,
      taskId: chatSessions.taskId,
    })
    .from(chatSessions)
    .where(eq(chatSessions.id, confirmation.chatSessionId));

  if (!session) throw new Error("Chat session not found");

  const resolvedStatus = action === "confirm" ? "confirmed" : "rejected";

  // Load persisted messages, annotate the tool-call, then update the specific row
  const persistedMessages = await getActiveSessionMessages(confirmation.chatSessionId);
  console.log(`[resolveConfirmation] Loaded ${persistedMessages.length} messages for annotation`);

  annotateToolCallConfirmation(
    persistedMessages,
    confirmation.toolCallId,
    confirmation.id,
    resolvedStatus,
  );

  // Find the annotated message and update its content in DB
  for (const msg of persistedMessages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && part.toolCallId === confirmation.toolCallId) {
        const record = msg as Record<string, unknown>;
        await updateMessageContent(record.id as string, msg.content);
      }
    }
  }

  console.log(`[resolveConfirmation] Annotated messages, about to handle reject/events`);

  // For rejection: insert a proper tool-result with isError so the SDK sees a complete
  // tool-call → tool-result pair and won't throw AI_MissingToolResultsError on resume.
  // For approval: don't insert anything — resolvePendingToolCalls in agent.ts will
  // execute the tool and create the tool-result before the next streamText call.
  if (action === "reject") {
    const rejectResult = {
      id: crypto.randomUUID(),
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: confirmation.toolCallId,
          toolName: confirmation.toolName,
          output: { error: "User rejected this action" },
          isError: true,
        },
      ],
    } as unknown as ModelMessage;
    await insertMessages(confirmation.chatSessionId, [rejectResult]);

    // Emit tool-result event so SSE clients see the rejection immediately.
    // Since resolvePendingToolCalls skips tools that already have a tool-result in DB,
    // the rejection event must be emitted here.
    await publishEvent({
      sessionId: confirmation.chatSessionId,
      event: "tool-result",
      data: {
        toolCallId: confirmation.toolCallId,
        toolName: confirmation.toolName,
        output: { error: "User rejected this action" },
        isError: true,
        error: "User rejected this action",
      },
      timestamp: Date.now(),
    });
  }

  console.log(`[resolveConfirmation] About to emit confirmation_resolved event`);
  // Emit per-confirmation resolved event so client can update UI immediately
  await publishEvent({
    sessionId: confirmation.chatSessionId,
    event: "confirmation_resolved",
    data: {
      confirmationId,
      toolCallId: confirmation.toolCallId,
      toolName: confirmation.toolName,
      action: resolvedStatus,
    },
    timestamp: Date.now(),
  });

  // Check if there are remaining pending confirmations for this session
  const [{ count: pendingCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(confirmations)
    .where(
      and(
        eq(confirmations.chatSessionId, confirmation.chatSessionId),
        eq(confirmations.status, "pending"),
      ),
    );

  console.log(
    `[resolveConfirmation] pendingCount=${pendingCount} (type=${typeof pendingCount}) session=${confirmation.chatSessionId}`,
  );

  if (Number(pendingCount) > 0) {
    const pendingRows = await db
      .select({
        id: confirmations.id,
        toolCallId: confirmations.toolCallId,
        toolName: confirmations.toolName,
        createdAt: confirmations.createdAt,
      })
      .from(confirmations)
      .where(
        and(
          eq(confirmations.chatSessionId, confirmation.chatSessionId),
          eq(confirmations.status, "pending"),
        ),
      );
    console.log(`[resolveConfirmation] Pending confirmations:`, JSON.stringify(pendingRows));
  }

  // Only resume the agent when ALL confirmations have been resolved
  // Note: SQLite count(*) may return string; use == for loose comparison
  if (pendingCount == 0) {
    await db
      .update(chatSessions)
      .set({
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

    console.log(
      `[resolveConfirmation] All confirmations resolved, publishing task to resume agent`,
    );
    // Signal agent to resume via queue
    await publishTask({
      sessionId: confirmation.chatSessionId,
      userId: confirmation.userId,
      type: "confirmation_resolved",
      timestamp: Date.now(),
    });
  } else {
    console.log(
      `[resolveConfirmation] Still ${pendingCount} pending confirmations, NOT resuming agent`,
    );
  }

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
      perms.push({
        toolName: confirmation.toolName,
        permission: "auto-confirm",
      });
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

  console.log(`[resolveConfirmation] DONE id=${confirmationId} action=${action}`);
  return { action, confirmationId };
}

function formatToolName(name: string): string {
  return name.replace(/_/g, " ");
}
