import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { chatSessions, scheduledNotifications } from "@/lib/db/schema";
import { sendPushNotification } from "@/lib/push";
import { scheduleNotification } from "@/lib/celery/client";
import { convertRunsAtToUTC } from "@/lib/utils/timezone";
import { eq, and } from "drizzle-orm";

export const sendNotificationTool = (userId: string, sessionId?: string) =>
  tool({
    description:
      "Send a push notification to all of the user's registered devices. Use this to proactively alert the user about important information, reminders, or updates. " +
      "Can optionally schedule the notification for a future time. " +
      "When scheduling, times should be specified in the provided timezone or the user's session timezone — they will be automatically converted to UTC.",
    inputSchema: z.object({
      title: z.string().describe("Notification title"),
      body: z.string().describe("Notification body text"),
      scheduledAt: z
        .string()
        .optional()
        .nullable()
        .describe(
          "ISO datetime for when the notification should be sent (e.g. '2025-01-15T09:00:00'). " +
            "Specify in the given timezone. If omitted, the notification is sent immediately.",
        ),
      timezone: z
        .string()
        .optional()
        .nullable()
        .describe(
          "IANA timezone for interpreting scheduledAt (e.g. 'America/New_York'). " +
            "If null or omitted, the chat session's timezone is used.",
        ),
    }),
    execute: async ({ title, body, scheduledAt, timezone }) => {
      try {
        // Immediate send when no scheduledAt
        if (!scheduledAt) {
          await sendPushNotification(userId, {
            title,
            body,
            data: { type: "agent_notification" },
          });
          return { sent: true };
        }

        // Resolve timezone: explicit > session > null (treated as UTC)
        let resolvedTimezone: string | null = timezone ?? null;
        if (!resolvedTimezone && sessionId) {
          const [session] = await db
            .select({ timezone: chatSessions.timezone })
            .from(chatSessions)
            .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
          resolvedTimezone = session?.timezone ?? null;
        }

        // Convert scheduledAt to UTC
        const utcScheduledAt = convertRunsAtToUTC(scheduledAt, resolvedTimezone);
        if (!utcScheduledAt || Number.isNaN(new Date(utcScheduledAt).getTime())) {
          return {
            sent: false,
            error: `Invalid scheduledAt "${scheduledAt}" or timezone "${resolvedTimezone ?? "UTC"}"`,
          };
        }

        // Persist the scheduled notification
        const [created] = await db
          .insert(scheduledNotifications)
          .values({
            userId,
            title,
            body,
            scheduledAt: utcScheduledAt,
          })
          .returning();

        // Register with Celery scheduler
        await scheduleNotification(created.id, utcScheduledAt);

        return { scheduled: true, notificationId: created.id, scheduledAt: utcScheduledAt };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error sending notification";
        console.error("[send_notification] Error:", err);
        return { sent: false, error: message };
      }
    },
  });

export const SEND_NOTIFICATION_TOOL_NAME = "send_notification";
