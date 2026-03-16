import { tool } from "ai";
import { z } from "zod";
import { sendPushNotification } from "@/lib/push";

export const sendNotificationTool = (userId: string, needsApproval: boolean) =>
  tool({
    description:
      "Send a push notification to all of the user's registered devices. Use this to proactively alert the user about important information, reminders, or updates.",
    needsApproval,
    inputSchema: z.object({
      title: z.string().describe("Notification title"),
      body: z.string().describe("Notification body text"),
    }),
    execute: async ({ title, body }) => {
      try {
        await sendPushNotification(userId, {
          title,
          body,
          data: { type: "agent_notification" },
        });

        return { sent: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error sending notification";
        console.error("[send_notification] Error:", err);
        return { sent: false, error: message };
      }
    },
  });

export const SEND_NOTIFICATION_TOOL_NAME = "send_notification";
