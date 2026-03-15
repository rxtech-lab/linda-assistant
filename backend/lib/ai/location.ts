import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import { assignees, chatSessions } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import type { ToolPermission } from "@/lib/db/schema";
import { sendPushNotification, sendSilentPushNotification } from "@/lib/push";
import { publishTask, publishEvent } from "@/lib/queue/producer";
import { annotateToolCallConfirmation } from "./agent";
import { getActiveSessionMessages, updateMessageContent } from "@/lib/db/messages";

const LOCATION_REQUEST_KEY = (toolCallId: string) => `location:request:${toolCallId}`;
const LOCATION_DATA_KEY = (toolCallId: string) => `location:data:${toolCallId}`;
const LOCATION_TTL = 10 * 60; // 10 minutes

interface CreateLocationRequestParams {
  userId: string;
  chatSessionId: string;
  toolCallId: string;
  toolName: string;
  approvalId: string;
  reason?: string;
  isAutoConfirm: boolean;
}

export async function createLocationRequest(params: CreateLocationRequestParams) {
  const requestData = {
    userId: params.userId,
    chatSessionId: params.chatSessionId,
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    approvalId: params.approvalId,
    reason: params.reason,
    status: "pending",
  };

  await redis.set(LOCATION_REQUEST_KEY(params.toolCallId), JSON.stringify(requestData), {
    ex: LOCATION_TTL,
  });

  if (params.isAutoConfirm) {
    // Send silent push to the last-used device only
    const [session] = await db
      .select({ deviceToken: chatSessions.deviceToken })
      .from(chatSessions)
      .where(eq(chatSessions.id, params.chatSessionId));

    if (session?.deviceToken) {
      await sendSilentPushNotification(session.deviceToken, {
        type: "location_request",
        toolCallId: params.toolCallId,
        chatSessionId: params.chatSessionId,
      }).catch((err) => {
        console.error("Failed to send silent push for location:", err);
      });
    } else {
      console.warn(
        `[location] No device token for session ${params.chatSessionId}, cannot send silent push`,
      );
    }
  } else {
    // Send regular push notification to all user devices
    await sendPushNotification(params.userId, {
      title: "Location Requested",
      body: params.reason
        ? `Linda needs your location: ${params.reason}`
        : "Linda needs your current location. Please review.",
      data: {
        type: "location",
        toolCallId: params.toolCallId,
        chatSessionId: params.chatSessionId,
      },
    }).catch((err) => {
      console.error("Failed to send push notification for location:", err);
    });
  }

  return requestData;
}

export async function resolveLocationRequest(
  toolCallId: string,
  userId: string,
  action: "confirm" | "reject",
  data?: { latitude: number; longitude: number; accuracy: number },
  options?: { alwaysAllow?: boolean },
) {
  console.log(`[resolveLocation] START toolCallId=${toolCallId} action=${action}`);

  const raw = await redis.get(LOCATION_REQUEST_KEY(toolCallId));
  if (!raw) throw new Error("Location request not found or expired");

  const request = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (request.userId !== userId) throw new Error("Location request does not belong to this user");
  if (request.status !== "pending") throw new Error("Location request already resolved");

  // Update request status
  request.status = action === "confirm" ? "confirmed" : "rejected";
  await redis.set(LOCATION_REQUEST_KEY(toolCallId), JSON.stringify(request), {
    ex: LOCATION_TTL,
  });

  // Store location data or rejection marker
  if (action === "confirm" && data) {
    await redis.set(LOCATION_DATA_KEY(toolCallId), JSON.stringify(data), {
      ex: LOCATION_TTL,
    });
  } else {
    await redis.set(LOCATION_DATA_KEY(toolCallId), JSON.stringify({ rejected: true }), {
      ex: LOCATION_TTL,
    });
  }

  const chatSessionId = request.chatSessionId;

  // Annotate the tool-call in persisted messages
  const persistedMessages = await getActiveSessionMessages(chatSessionId);
  annotateToolCallConfirmation(
    persistedMessages,
    toolCallId,
    toolCallId, // use toolCallId as the "confirmation id" for location
    request.status,
  );

  // Persist updated annotation
  for (const msg of persistedMessages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && part.toolCallId === toolCallId) {
        const record = msg as Record<string, unknown>;
        await updateMessageContent(record.id as string, msg.content);
      }
    }
  }

  // Emit location_resolved event
  await publishEvent({
    sessionId: chatSessionId,
    event: "location_resolved",
    data: {
      toolCallId,
      toolName: request.toolName,
      action: request.status,
    },
    timestamp: Date.now(),
  });

  // Resume the agent
  await db
    .update(chatSessions)
    .set({
      status: "in_progress",
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(chatSessions.id, chatSessionId));

  await publishEvent({
    sessionId: chatSessionId,
    event: "status",
    data: { status: "in_progress" },
    timestamp: Date.now(),
  });

  await publishTask({
    sessionId: chatSessionId,
    userId,
    type: "location_resolved",
    timestamp: Date.now(),
  });

  // Handle alwaysAllow — update assignee's toolPermissions to auto-confirm get_location
  if (action === "confirm" && options?.alwaysAllow) {
    const [session] = await db
      .select({ assigneeId: chatSessions.assigneeId })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));

    if (session?.assigneeId) {
      const [assignee] = await db
        .select({ toolPermissions: assignees.toolPermissions })
        .from(assignees)
        .where(eq(assignees.id, session.assigneeId));

      const perms: ToolPermission[] = (assignee?.toolPermissions as ToolPermission[]) ?? [];
      const idx = perms.findIndex((tp) => tp.toolName === request.toolName);
      if (idx >= 0) {
        perms[idx].permission = "auto-confirm";
      } else {
        perms.push({ toolName: request.toolName, permission: "auto-confirm" });
      }

      await db
        .update(assignees)
        .set({ toolPermissions: perms, updatedAt: sql`(datetime('now'))` })
        .where(eq(assignees.id, session.assigneeId));
    }
  }

  console.log(`[resolveLocation] DONE toolCallId=${toolCallId} action=${action}`);
  return { action, toolCallId };
}
